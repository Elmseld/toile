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
//   * Typing in a formula or parameter field works the same way: the keystrokes of a frame are
//     evaluated once, in a requestAnimationFrame, and drawn with the labels where they are. The
//     labels (placeLabel, several ms per piece) are placed again once typing pauses for
//     LABEL_DELAY_MS, or at once on the field's `change`. A drag cancels a pending placement and
//     places the labels at its end.
//   * A commit (drag end, a field's `change`, offset reset, undo, redo) pushes the working state
//     onto the history and saves it with the `save_pattern` hook event. One save is in flight at
//     a time: commits made meanwhile only bump `revision`, and the reply sends the history's
//     present state if it is newer, so holding down undo sends a few saves, not one per step.
//     `revision`/`savedRevision` tell whether the last commit is stored. `resendIfUnsaved()`
//     (called on reconnect) saves it again if not, at most MAX_RESENDS times in a row with a
//     growing delay, so a save that keeps failing does not loop. A save without a reply within
//     SAVE_TIMEOUT_MS counts as failed and its late reply is ignored; a reconnect forgets the
//     saves sent before it the same way, so a lost reply never stalls the autosave. A save larger
//     than the hook's `data-max-save-bytes`, or with a definition larger than
//     `data-max-definition-bytes`, is not sent (the server would drop the connection or reject
//     it) and shows as failed. When the editor is destroyed with a commit not stored, it is sent
//     once more.

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
import {encodedBytes, parseJSON} from "../json"
import {Handles, hitRadius} from "./handles"
import {Panels, errorText} from "./panels"

/** A press that moves less than this many pixels only selects the point. */
const DRAG_THRESHOLD_PX = 3
/** How long typing must pause before the labels are placed again. */
const LABEL_DELAY_MS = 150
/** Resends of an unsaved commit after reconnects before giving up until the next commit. */
const MAX_RESENDS = 3
/** The delay before the first resend after a reconnect; it doubles with each further one. */
const RESEND_DELAY_MS = 500
/** How long a save may wait for its reply before it counts as failed. */
const SAVE_TIMEOUT_MS = 10_000

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

/** A positive byte cap from a data attribute, or Infinity when it is missing or not one. */
function byteCap(text) {
  const cap = Number(text)
  return Number.isFinite(cap) && cap > 0 ? cap : Infinity
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
    return new PatternEditor({
      hook,
      aside,
      texts,
      definition,
      parameters,
      maxSaveBytes: byteCap(hook.el.dataset.maxSaveBytes),
      maxDefinitionBytes: byteCap(hook.el.dataset.maxDefinitionBytes),
    })
  }

  constructor({
    hook,
    aside,
    texts,
    definition,
    parameters,
    maxSaveBytes = Infinity,
    maxDefinitionBytes = Infinity,
  }) {
    this.hook = hook
    this.aside = aside
    this.texts = texts
    this.maxSaveBytes = maxSaveBytes
    this.maxDefinitionBytes = maxDefinitionBytes
    this.panels = new Panels(aside, texts, parameters)
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
    // Saves sent and not answered yet (token => timeout), resends since the last stored save, a
    // scheduled resend. Only a save still in `pending` is answered by its reply or timeout.
    this.pending = new Map()
    this.nextToken = 0
    this.resends = 0
    this.resendTimer = null
    // The field typed in since the last evaluation, and the frame that will evaluate it.
    this.pendingInput = null
    this.inputFrame = null
    // Whether the drawn labels belong to an earlier result, and the timer that places them again.
    this.labelsStale = false
    this.labelTimer = null
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

  /**
   * Stops the editor. Typing not evaluated yet is evaluated and committed, and a commit that is
   * not stored is sent once more (unless a save is still in flight: its reply sends it).
   */
  destroy() {
    this.flushInput()
    if (this.drag?.frame != null) cancelAnimationFrame(this.drag.frame)
    this.drag = null
    this.commit()
    this.destroyed = true
    if (this.resendTimer !== null) clearTimeout(this.resendTimer)
    this.resendTimer = null
    this.cancelLabels()
    if (this.savedRevision < this.revision && this.pending.size === 0) this.send()
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
    this.flushInput()
    // The hook draws the result anew, labels included.
    this.cancelLabels()
    this.labelsStale = false
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

  /** Draws `result`; with labels "keep" the labels stay where they are until placeLabels(). */
  show(result, labels = "place") {
    this.result = result
    if (labels === "place") this.cancelLabels()
    this.labelsStale = labels !== "place"
    this.hook.update(result, {labels})
  }

  /**
   * Makes `state` the working state if it evaluates without errors, and redraws (with labels
   * "keep" the labels are placed again after a pause). Returns the result either way; on errors
   * nothing changes.
   */
  accept(state, labels = "place") {
    const result = this.evaluate(state)
    if (result.ok) {
      this.state = state
      this.show(result, labels)
      if (labels !== "place") this.scheduleLabels()
      this.panels.setAlert(null)
    }
    return result
  }

  /** Places the labels again after LABEL_DELAY_MS, unless something places them before. */
  scheduleLabels() {
    this.cancelLabels()
    this.labelTimer = setTimeout(() => {
      this.labelTimer = null
      this.placeLabels()
    }, LABEL_DELAY_MS)
  }

  cancelLabels() {
    if (this.labelTimer !== null) clearTimeout(this.labelTimer)
    this.labelTimer = null
  }

  /** Places the labels for the drawn result now, if they belong to an earlier one. */
  placeLabels() {
    this.cancelLabels()
    if (this.destroyed || this.drag || !this.labelsStale || !this.result) return
    this.show(this.result)
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
    this.flushInput()
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

  /** Saves the history's present state: now, or when the save in flight is answered. */
  save() {
    if (this.destroyed) return
    this.revision++
    this.resends = 0
    this.panels.setStatus("saving")
    if (this.pending.size === 0) this.send()
  }

  // Sends the history's present state as the current revision. A save over a size cap is not
  // sent: it shows as failed and stays unsaved. The save is answered once: by its reply, or as
  // failed after SAVE_TIMEOUT_MS, whichever comes first.
  send() {
    const revision = this.revision
    const {definition, parameters} = this.history.present
    const definitionBytes = encodedBytes(definition)
    if (
      definitionBytes > this.maxDefinitionBytes ||
      definitionBytes + encodedBytes(parameters) > this.maxSaveBytes
    ) {
      if (!this.destroyed) this.panels.setStatus("failed")
      return
    }
    const token = ++this.nextToken
    this.pending.set(
      token,
      setTimeout(() => this.settle(token, revision, false), SAVE_TIMEOUT_MS),
    )
    this.hook.pushEvent("save_pattern", {definition, parameters}).then(
      reply => this.settle(token, revision, reply?.ok === true),
      () => this.settle(token, revision, false),
    )
  }

  // Answers the save `token` unless its reply or timeout already did, or a reconnect forgot it.
  settle(token, revision, ok) {
    if (!this.pending.has(token)) return
    clearTimeout(this.pending.get(token))
    this.pending.delete(token)
    this.saved(revision, ok)
  }

  // Forgets the saves in flight: after a reconnect their replies will not come.
  forgetPending() {
    for (const timer of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
  }

  saved(revision, ok) {
    if (ok) {
      this.savedRevision = Math.max(this.savedRevision, revision)
      this.resends = 0
    }
    // Commits made while this save was in flight: send the newest state, once.
    if (this.pending.size === 0 && revision < this.revision && this.savedRevision < this.revision) {
      this.send()
      return
    }
    if (this.destroyed) return
    if (this.savedRevision >= this.revision) this.panels.setStatus("saved")
    else if (!ok && revision === this.revision) this.panels.setStatus("failed")
  }

  /**
   * Saves the present state again if the last commit is not stored (after a reconnect), after a
   * delay that doubles with each resend. Gives up after MAX_RESENDS in a row without a stored
   * save, until the next commit. The saves sent before the reconnect are forgotten: a late reply
   * to one of them is ignored.
   */
  resendIfUnsaved() {
    if (this.destroyed) return
    this.forgetPending()
    if (this.resendTimer !== null) return
    if (this.savedRevision >= this.revision) return
    if (this.resends >= MAX_RESENDS) {
      // A forgotten save would otherwise leave "saving" showing.
      this.panels.setStatus("failed")
      return
    }
    const delay = RESEND_DELAY_MS * 2 ** this.resends
    this.resends++
    this.resendTimer = setTimeout(() => {
      this.resendTimer = null
      if (this.destroyed || this.savedRevision >= this.revision) return
      this.panels.setStatus("saving")
      this.send()
    }, delay)
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
    // The labels are placed at the drag's end instead.
    this.cancelLabels()
    this.drag = {
      name,
      start: offsetOf(this.selectedPoint()),
      grab: this.hook.toUser(event.clientX, event.clientY),
      client: {x: event.clientX, y: event.clientY},
      moved: false,
      // The client position of the last move not evaluated yet.
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
    drag.pending = {x: event.clientX, y: event.clientY}
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
    const client = drag.pending
    if (!client || drag !== this.drag) return
    drag.pending = null
    const at = this.hook.toUser(client.x, client.y)
    const offset = roundOffset({
      dx: drag.start.dx + at.x - drag.grab.x,
      dy: drag.start.dy + at.y - drag.grab.y,
    })
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
    if (!drag.moved) {
      this.placeLabels()
      return
    }

    const state = drag.offset
      ? withDefinition(this.state, this.offsetDefinition(drag))
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

  // The working definition with the dragged offset. Back at the start it is the same object (no
  // history step); an offset of (0, 0) removes the key, as the reset button does.
  offsetDefinition({name, start, offset}) {
    const definition = this.state.definition
    if (offset.dx === start.dx && offset.dy === start.dy) return definition
    const zero = offset.dx === 0 && offset.dy === 0
    return setUserOffset(definition, name, zero ? null : offset)
  }

  /** Ends a drag without a change: the point returns to where it was. */
  cancelDrag() {
    const drag = this.drag
    if (!drag) return
    this.drag = null
    if (drag.frame !== null) cancelAnimationFrame(drag.frame)
    if (drag.offset) this.restore("keep")
    if (this.labelsStale) this.scheduleLabels()
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

  // Keystrokes are evaluated once per frame (flushInput); typing in another field first
  // evaluates the one before.
  input(event) {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    if (this.pendingInput && this.pendingInput !== target) this.flushInput()
    this.pendingInput = target
    if (this.inputFrame === null) {
      this.inputFrame = requestAnimationFrame(() => {
        this.inputFrame = null
        this.flushInput()
      })
    }
  }

  /** Evaluates the field typed in since the last evaluation, if any. */
  flushInput() {
    if (this.inputFrame !== null) cancelAnimationFrame(this.inputFrame)
    this.inputFrame = null
    const target = this.pendingInput
    this.pendingInput = null
    if (!target?.isConnected || this.destroyed) return
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
      this.placeLabels()
      this.markIfNotSaved(target)
    } else if (target instanceof HTMLInputElement) {
      const row = this.parameterRow(target)
      if (!row) return
      this.commit()
      this.placeLabels()
      // A value that was taken is shown the way the panel writes it ("4.50" as "4,5", an empty
      // field as the default).
      if (!this.markIfNotSaved(target)) this.panels.renderParameter(row, this.state.parameters)
    }
  }

  // A field left with text the pattern cannot use keeps that text, so the user can fix it, and
  // its error says it was not saved: the commit saved the last value that worked. Resetting the
  // field instead would throw the typing away. Returns whether the field had an error.
  markIfNotSaved(input) {
    if (input.getAttribute("aria-invalid") !== "true") return false
    this.panels.setNotSaved(input)
    return true
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
    const result = this.accept(state, "keep")
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
    const result = this.accept(state, "keep")
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
      // The pointer is still down: from here on it pans, like a press beside a point.
      this.hook.dragCancelled()
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
