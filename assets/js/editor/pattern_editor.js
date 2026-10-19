// PatternEditor: the browser side of the pattern editor (docs/adr/0008-pattern-editor.md).
//
// The editor owns the edit state of the page: the working definition and parameter overrides,
// the selected point, a drag in progress and the undo/redo history (the engine's editor helpers).
// The PatternView hook draws; the editor tells it what to draw (`hook.update(result, {labels})`)
// and gets the presses on points (`pointerDown`, `moveDrag`, `endDrag`, `cancelDrag`).
//
// Rules:
//   * A change becomes the working state only when the engine evaluates it without errors, so
//     the drawing always shows the last good state and every saved state draws.
//   * During a drag each pointer move does one evaluation with the dragged offset, in a
//     requestAnimationFrame, and the labels keep their place. Nothing is sent to the server.
//   * A commit (drag end, a field's `change`, offset reset, undo, redo) pushes the working state
//     onto the history and saves it with the `save_pattern` hook event. Replies come back in
//     order; `revision`/`savedRevision` tell whether the last commit is stored, and
//     `resendIfUnsaved()` (called on reconnect) saves it again if not.

import {
  canRedo,
  canUndo,
  compilePattern,
  controlPoints,
  createHistory,
  errorsFor,
  fromDisplay,
  getPoint,
  pickPoint,
  push,
  redo,
  roundOffset,
  setPointFormula,
  setUserOffset,
  undo,
} from "../../../engine/src/index"
import {Handles, hitRadius} from "./handles"
import {Panels, errorText} from "./panels"

/** A press that moves less than this many pixels only selects the point. */
const DRAG_THRESHOLD_PX = 3

function parseJSON(text, fallback) {
  try {
    return JSON.parse(text ?? "")
  } catch {
    return fallback
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A point's stored offset, or none (0, 0) when it has no usable one. */
function offsetOf(point) {
  const offset = point?.user_offset
  return isObject(offset) && Number.isFinite(offset.dx) && Number.isFinite(offset.dy)
    ? {dx: offset.dx, dy: offset.dy}
    : {dx: 0, dy: 0}
}

/** `state` with `definition`, or `state` itself when the definition is the same object. */
function withDefinition(state, definition) {
  return definition === state.definition ? state : {definition, parameters: state.parameters}
}

/** `state` with `parameters`, or `state` itself when the parameters are the same object. */
function withParameters(state, parameters) {
  return parameters === state.parameters ? state : {definition: state.definition, parameters}
}

/** `parameters` with `name` set to `value` (removed for null); the same object if unchanged. */
function setParameter(parameters, name, value) {
  if (value === null) {
    if (!Object.hasOwn(parameters, name)) return parameters
    const {[name]: _removed, ...rest} = parameters
    return rest
  }
  return parameters[name] === value ? parameters : {...parameters, [name]: value}
}

/** Whether keyboard shortcuts should leave `target` alone (it edits text or a choice). */
function isFormTarget(target) {
  return target instanceof Element && target.closest("input, textarea, select, [contenteditable]")
}

export class PatternEditor {
  /**
   * The editor for `hook`, or null when the page has no editor aside (`data-editor`) or the
   * definition is not an object. `definition` is the stored definition and `input` the engine
   * input with the stored parameter overrides, both as decoded from the hook's data attributes.
   */
  static create(hook, definition, input) {
    const asideId = hook.el.dataset.editor
    const aside = asideId ? document.getElementById(asideId) : null
    if (!aside || !isObject(definition)) return null
    const parsed = parseJSON(hook.el.dataset.texts, {})
    const texts = isObject(parsed) ? parsed : {}
    const parameters = isObject(input?.parameters) ? input.parameters : {}
    return new PatternEditor({hook, aside, texts, definition, parameters})
  }

  constructor({hook, aside, texts, definition, parameters}) {
    this.hook = hook
    this.aside = aside
    this.texts = texts
    this.panels = new Panels(aside, texts)
    this.handles = new Handles(definition, controlPoints(definition))

    this.state = {definition, parameters: {...parameters}}
    this.history = createHistory(this.state)
    this.measurements = {}
    this.compiled = null
    this.compiledFor = null
    // The last result drawn (always ok); what the handles show and presses are picked from.
    this.result = null
    this.selected = null
    this.drag = null
    this.revision = 0
    this.savedRevision = 0
    this.destroyed = false

    this.onClick = event => this.click(event)
    this.onInput = event => this.input(event)
    this.onChange = event => this.change(event)
    this.onKeyDown = event => this.keyDown(event)
    aside.addEventListener("click", this.onClick)
    aside.addEventListener("input", this.onInput)
    aside.addEventListener("change", this.onChange)
    window.addEventListener("keydown", this.onKeyDown)
  }

  destroy() {
    this.destroyed = true
    if (this.drag?.frame != null) cancelAnimationFrame(this.drag.frame)
    this.drag = null
    this.aside.removeEventListener("click", this.onClick)
    this.aside.removeEventListener("input", this.onInput)
    this.aside.removeEventListener("change", this.onChange)
    window.removeEventListener("keydown", this.onKeyDown)
  }

  // ---- Evaluation and drawing ----

  /**
   * Takes the measurements of `input` (on mount and when the profile changes; the editor keeps
   * its own parameters and definition) and returns the result of the working state for them, or
   * null without input. The hook draws it.
   */
  load(input) {
    this.cancelDrag()
    if (!isObject(input)) return null
    this.measurements = isObject(input.measurements) ? input.measurements : {}
    const result = this.evaluate(this.state)
    this.result = result.ok ? result : null
    return result
  }

  /** Evaluates `state`, with `offsets` replacing user offsets; compiles once per definition. */
  evaluate(state, offsets = null) {
    if (this.compiledFor !== state.definition) {
      this.compiled = compilePattern(state.definition)
      this.compiledFor = state.definition
    }
    const input = {measurements: this.measurements, parameters: state.parameters}
    return offsets ? this.compiled.evaluate(input, {offsets}) : this.compiled.evaluate(input)
  }

  show(result, labels = "place") {
    this.result = result
    this.hook.update(result, {labels})
  }

  /**
   * Makes `state` the working state if it evaluates without errors, and redraws. Returns the
   * result either way; on errors nothing changes.
   */
  accept(state) {
    const result = this.evaluate(state)
    if (result.ok) {
      this.state = state
      this.show(result)
      this.panels.setAlert(null)
    }
    return result
  }

  // Called by the hook while it builds, moves and scales the drawing.
  drawHandles(layer, result) {
    this.handles.build(layer, result)
  }

  moveHandles(result) {
    this.handles.update(result)
  }

  scaleHandles(pixelsPerUnit) {
    this.handles.scale(pixelsPerUnit)
  }

  // ---- History and saving ----

  /** Pushes the working state onto the history and saves it, if it changed. */
  commit() {
    if (this.state === this.history.present) return
    this.history = push(this.history, this.state)
    this.historyChanged()
    this.save()
  }

  historyChanged() {
    this.panels.setHistory(canUndo(this.history), canRedo(this.history))
  }

  undo() {
    this.travel(undo)
  }

  redo() {
    this.travel(redo)
  }

  travel(step) {
    if (this.drag) return
    this.commit()
    const history = step(this.history)
    if (history === this.history) return
    this.history = history
    this.state = history.present
    // Every state in the history drew when it was committed, but the profile may have changed
    // since. Then the drawing stays as it was and the alert says why.
    const result = this.evaluate(this.state)
    if (result.ok) {
      this.show(result)
      this.panels.setAlert(null)
    } else {
      this.panels.setAlert(errorText(this.texts, null))
    }
    this.panels.renderPoint(this.selectedPoint())
    this.panels.renderParameters(this.state.parameters)
    this.historyChanged()
    this.save()
  }

  save() {
    if (this.destroyed) return
    const revision = ++this.revision
    const {definition, parameters} = this.history.present
    this.panels.setStatus("saving")
    this.hook.pushEvent("save_pattern", {definition, parameters}).then(
      reply => this.saved(revision, reply?.ok === true),
      () => this.saved(revision, false),
    )
  }

  saved(revision, ok) {
    if (this.destroyed) return
    if (ok) this.savedRevision = Math.max(this.savedRevision, revision)
    if (this.savedRevision >= this.revision) this.panels.setStatus("saved")
    else if (!ok && revision === this.revision) this.panels.setStatus("failed")
  }

  /** Saves the present state again if the last save did not succeed (after a reconnect). */
  resendIfUnsaved() {
    if (this.savedRevision < this.revision) this.save()
  }

  // ---- Selection ----

  selectedPoint() {
    return this.selected ? getPoint(this.state.definition, this.selected) : undefined
  }

  /** Selects the point `name` (null for none) and shows it in the point panel. */
  select(name) {
    this.commit()
    const point = name ? getPoint(this.state.definition, name) : undefined
    const selected = point ? name : null
    if (selected === this.selected) return
    this.selected = selected
    this.handles.select(selected)
    this.panels.renderPoint(point)
  }

  /** The point under a pointer event, or null. */
  pick(event) {
    if (!this.result) return null
    const at = this.hook.toUser(event.clientX, event.clientY)
    const radius = hitRadius(event.pointerType) / this.hook.pixelScale()
    return pickPoint(this.result.points, at, radius, this.selected ?? undefined)
  }

  // ---- Dragging ----

  /**
   * A press with no other pointer down. On a point it selects it, starts a drag and returns
   * true: the hook then sends this pointer's moves and release here. Otherwise returns false and
   * the hook pans.
   */
  pointerDown(event) {
    const name = this.pick(event)
    if (name === null) return false
    this.cancelDrag()
    this.select(name)
    this.drag = {
      name,
      start: offsetOf(this.selectedPoint()),
      grab: this.hook.toUser(event.clientX, event.clientY),
      client: {x: event.clientX, y: event.clientY},
      moved: false,
      pending: null,
      offset: null,
      frame: null,
    }
    return true
  }

  moveDrag(event) {
    const drag = this.drag
    if (!drag) return
    if (!drag.moved) {
      const distance = Math.hypot(event.clientX - drag.client.x, event.clientY - drag.client.y)
      if (distance < DRAG_THRESHOLD_PX) return
      drag.moved = true
    }
    const at = this.hook.toUser(event.clientX, event.clientY)
    drag.pending = roundOffset({
      dx: drag.start.dx + at.x - drag.grab.x,
      dy: drag.start.dy + at.y - drag.grab.y,
    })
    if (drag.frame === null) {
      drag.frame = requestAnimationFrame(() => {
        drag.frame = null
        this.flushDrag(drag)
      })
    }
  }

  // One evaluation with the dragged offset. A position the pattern cannot be drawn with is
  // skipped: the drawing (and the offset that will be committed) stays the last good one.
  flushDrag(drag) {
    const offset = drag.pending
    if (!offset || drag !== this.drag) return
    drag.pending = null
    const result = this.evaluate(this.state, {[drag.name]: offset})
    if (!result.ok) return
    drag.offset = offset
    this.show(result, "keep")
  }

  /** The release of a drag: commits the last good offset and places the labels again. */
  endDrag() {
    const drag = this.drag
    if (!drag) return
    if (drag.frame !== null) cancelAnimationFrame(drag.frame)
    drag.frame = null
    this.flushDrag(drag)
    this.drag = null
    if (!drag.moved) return

    const state = drag.offset
      ? withDefinition(this.state, setUserOffset(this.state.definition, drag.name, drag.offset))
      : this.state
    const result = this.evaluate(state)
    if (result.ok) {
      this.state = state
      this.show(result)
      this.panels.setAlert(null)
    } else {
      this.restore()
    }
    this.commit()
    this.panels.renderPoint(this.selectedPoint())
  }

  /** Ends a drag without a change: the point returns to where it was. */
  cancelDrag() {
    const drag = this.drag
    if (!drag) return
    this.drag = null
    if (drag.frame !== null) cancelAnimationFrame(drag.frame)
    if (drag.offset) this.restore("keep")
  }

  // Draws the working state again, if it draws.
  restore(labels = "place") {
    const result = this.evaluate(this.state)
    if (result.ok) this.show(result, labels)
  }

  // ---- Panels ----

  click(event) {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest("#undo-button")) this.undo()
    else if (target?.closest("#redo-button")) this.redo()
    else if (target?.closest("#reset-offset")) this.resetOffset()
  }

  input(event) {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    if (target.dataset.field) this.formulaInput(target.dataset.field, target.value)
    else {
      const row = this.parameterRow(target)
      if (row) this.parameterInput(row, target.value)
    }
  }

  change(event) {
    const target = event.target
    if (target instanceof HTMLSelectElement && target.id === "point-select") {
      this.select(target.value || null)
    } else if (target instanceof HTMLInputElement && target.dataset.field) {
      this.commit()
    } else if (target instanceof HTMLInputElement) {
      const row = this.parameterRow(target)
      if (!row) return
      this.commit()
      // A value that was taken is shown the way the panel writes it ("4.50" as "4,5", an empty
      // field as the default); a rejected one stays with its error.
      if (target.getAttribute("aria-invalid") !== "true") {
        this.panels.renderParameter(row, this.state.parameters)
      }
    }
  }

  /** A keystroke in a formula field of the selected point: evaluate it, keep it if it draws. */
  formulaInput(field, text) {
    if (!this.selected || this.drag) return
    const definition = setPointFormula(this.state.definition, this.selected, field, text)
    const state = withDefinition(this.state, definition)
    if (state === this.state) {
      this.panels.setFieldError(field, null)
      return
    }
    const result = this.accept(state)
    this.panels.setFieldError(field, result.ok ? null : this.fieldErrorText(result.errors, field))
  }

  // The text for the errors of an edit of `field` of the selected point: the field's own error,
  // else an error of the point as a whole (lines that do not meet), else the generic text.
  fieldErrorText(errors, field) {
    const own =
      errorsFor(errors, this.selected, field)[0] ??
      errorsFor(errors, this.selected).find(error => !("field" in error))
    return errorText(this.texts, own ?? null)
  }

  parameterRow(input) {
    const row = input.closest("[data-parameter]")
    return row ? this.panels.parameterRows().find(r => r.name === row.dataset.parameter) : null
  }

  /**
   * A keystroke in a parameter field. Empty means the default; a value equal to the default is
   * not stored as an override.
   */
  parameterInput(row, text) {
    if (this.drag) return
    let value = null
    if (text.trim() !== "") {
      value = fromDisplay(text, row.unit)
      if (value === null) {
        this.panels.setParameterError(row.name, this.texts.errors?.parameter_format ?? "")
        return
      }
      if (value === row.default) value = null
    }
    const state = withParameters(this.state, setParameter(this.state.parameters, row.name, value))
    if (state === this.state) {
      this.panels.setParameterError(row.name, null)
      return
    }
    const result = this.accept(state)
    const own = result.ok ? [] : result.errors.filter(error => error.name === row.name)
    const error = result.ok ? null : errorText(this.texts, own[0] ?? null)
    this.panels.setParameterError(row.name, error)
  }

  resetOffset() {
    if (!this.selected || this.drag) return
    this.commit()
    const definition = setUserOffset(this.state.definition, this.selected, null)
    const result = this.accept(withDefinition(this.state, definition))
    if (!result.ok) this.panels.setAlert(errorText(this.texts, null))
    this.commit()
    this.panels.renderPoint(this.selectedPoint())
  }

  // ---- Keyboard ----

  keyDown(event) {
    if (event.key === "Escape" && this.drag) {
      this.cancelDrag()
      return
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || isFormTarget(event.target)) return
    const key = event.key.toLowerCase()
    let action = null
    if (key === "z") action = event.shiftKey ? "redo" : "undo"
    else if (key === "y" && event.ctrlKey) action = "redo"
    if (!action) return
    event.preventDefault()
    this[action]()
  }
}
