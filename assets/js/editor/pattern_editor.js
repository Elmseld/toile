// PatternEditor: the browser side of the pattern editor (docs/adr/0008-pattern-editor.md).
//
// The editor owns the edit state of the page for every part of the project (the main part and
// added parts such as a sleeve, ADR 0007): the working definitions and parameter overrides, the
// selected point, a drag in progress and the undo/redo history (the engine's editor helpers).
// A state is `{parts: {partName: {definition, parameters}}}`; an edit replaces one part's entry
// and keeps the others by reference. The PatternView hook draws; the editor tells it what to draw
// (`hook.update(result, {labels})`, with a project result) and gets the presses on points
// (`pointerDown`, `moveDrag`, `endDrag`, `cancelDrag`). A point is named by its part and name.
//
// Rules:
//   * All parts are evaluated together (the engine's compileProject), so a part that imports
//     from the edited one (the sleeve from the bodice armhole) follows every edit. A change
//     becomes the working state only when the whole project evaluates without errors, so the
//     drawing always shows the last good state and every saved state draws.
//   * During a drag each pointer move does one evaluation with the dragged offset, in a
//     requestAnimationFrame, and the labels keep their place. Nothing is sent to the server.
//   * Typing in a formula or parameter field works the same way: the keystrokes of a frame are
//     evaluated once, in a requestAnimationFrame, and drawn with the labels where they are. The
//     labels (placeLabel, several ms per piece) are placed again once typing pauses for
//     LABEL_DELAY_MS, or at once on the field's `change`. A drag cancels a pending placement and
//     places the labels at its end.
//   * A commit (drag end, a field's `change`, offset reset, undo, redo) pushes the working state
//     onto the history and saves the parts it changed, one `save_pattern` hook event per part
//     (`{part, definition, parameters}`). One save is in flight at a time; when it is answered,
//     the next part whose present state is not stored is sent, so holding down undo sends a few
//     saves, not one per step. `stored` holds the part states known to be stored (by reference).
//     A part whose save failed is not sent again with the same state until the next commit or
//     reconnect: `resendIfUnsaved()` (called on reconnect) saves the unstored parts again, at most
//     MAX_RESENDS times in a row with a growing delay, so a save that keeps failing does not
//     loop. A save without a reply within SAVE_TIMEOUT_MS counts as failed and its late reply is
//     ignored; a reconnect forgets the saves sent before it the same way, so a lost reply never
//     stalls the autosave. A part larger than the hook's `data-max-save-bytes`, or with a
//     definition larger than `data-max-definition-bytes`, is not sent (the server would drop the
//     connection or reject it) and shows as failed. When the editor is destroyed, every part not
//     stored is sent once more.
//   * A part added on the page (`addParts`) joins every state of the history, so undo and redo
//     keep it. The aside is rendered anew for the new part (`setAside`).

import {
  canRedo,
  canUndo,
  compileProject,
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
/** Resends of unsaved parts after reconnects before giving up until the next commit. */
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

/** `state` with part `name` set to `part`, or `state` itself when it is the same object. */
function withPart(state, name, part) {
  return part === state.parts[name] ? state : {parts: {...state.parts, [name]: part}}
}

/** Part `name` of `state` with `definition`; the same object when the definition is. */
function partWithDefinition(state, name, definition) {
  const part = state.parts[name]
  return definition === part.definition ? part : {definition, parameters: part.parameters}
}

/** Part `name` of `state` with `parameters`; the same object when the parameters are. */
function partWithParameters(state, name, parameters) {
  const part = state.parts[name]
  return parameters === part.parameters ? part : {definition: part.definition, parameters}
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

/**
 * The well-formed entries of the hook's `data-parts`, `[{name, definition}]`, in order: a string
 * name seen for the first time and an object definition. Anything else is left to the engine,
 * which draws nothing then; the editor only edits what it can address.
 */
function readParts(parts) {
  if (!Array.isArray(parts)) return []
  const seen = new Set()
  const list = []
  for (const part of parts) {
    if (!isObject(part) || typeof part.name !== "string" || seen.has(part.name)) continue
    if (!isObject(part.definition)) continue
    seen.add(part.name)
    list.push({name: part.name, definition: part.definition})
  }
  return list
}

/** The stored parameter overrides of part `name` in the engine input `input`. */
function inputParameters(input, name) {
  const parameters = isObject(input?.parameters) ? input.parameters[name] : null
  return isObject(parameters) ? {...parameters} : {}
}

export class PatternEditor {
  /**
   * The editor for `hook`, or null when the page has no editor aside (`data-editor`) or no part
   * has an object definition. `parts` are the stored parts and `input` the engine input with
   * the stored parameter overrides by part name, both as decoded from the hook's data attributes.
   */
  static create(hook, parts, input) {
    const asideId = hook.el.dataset.editor
    const aside = asideId ? document.getElementById(asideId) : null
    const list = readParts(parts)
    if (!aside || list.length === 0) return null
    const parsed = parseJSON(hook.el.dataset.texts, {})
    const texts = isObject(parsed) ? parsed : {}
    const state = {parts: {}}
    for (const {name, definition} of list) {
      state.parts[name] = {definition, parameters: inputParameters(input, name)}
    }
    return new PatternEditor({
      hook,
      aside,
      texts,
      order: list.map(part => part.name),
      state,
      maxSaveBytes: byteCap(hook.el.dataset.maxSaveBytes),
      maxDefinitionBytes: byteCap(hook.el.dataset.maxDefinitionBytes),
    })
  }

  constructor({
    hook,
    aside,
    texts,
    order,
    state,
    maxSaveBytes = Infinity,
    maxDefinitionBytes = Infinity,
  }) {
    this.hook = hook
    this.texts = texts
    this.maxSaveBytes = maxSaveBytes
    this.maxDefinitionBytes = maxDefinitionBytes
    // The part names in project order (main part first), as the engine gets them.
    this.order = order
    this.state = state
    this.history = createHistory(this.state)
    this.handles = new Map()
    this.stored = new Map()
    for (const name of order) {
      const {definition} = state.parts[name]
      this.handles.set(name, new Handles(definition, controlPoints(definition)))
      this.stored.set(name, state.parts[name])
    }
    this.measurements = {}
    this.compiled = null
    this.compiledFor = null
    // The last result drawn (always ok); what the handles show and presses are picked from.
    this.result = null
    // The selected point, {part, name}, or null.
    this.selected = null
    this.drag = null
    // The last save status shown, so a new aside shows it too.
    this.status = null
    // Saves sent and not answered yet (token => timeout), parts whose save failed (name => the
    // part state that failed), resends since the last stored save, a scheduled resend. Only a
    // save still in `pending` is answered by its reply or timeout.
    this.pending = new Map()
    this.failed = new Map()
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
    this.aside = null
    this.setAside(aside)
    window.addEventListener("keydown", this.onKeyDown)
  }

  /**
   * Moves the editor to `aside` (the page rendered a new one, e.g. for an added part) and shows
   * the working state in it: parameters, the selected point, the history buttons and the status.
   */
  setAside(aside) {
    if (aside === this.aside) return
    this.flushInput()
    if (this.aside) this.unlisten(this.aside)
    this.aside = aside
    this.panels = new Panels(aside, this.texts, this.state.parts)
    aside.addEventListener("click", this.onClick)
    aside.addEventListener("input", this.onInput)
    aside.addEventListener("change", this.onChange)
    this.historyChanged()
    this.panels.setStatus(this.status)
    this.panels.renderPoint(this.selectedPoint(), this.selected?.part)
  }

  unlisten(aside) {
    aside.removeEventListener("click", this.onClick)
    aside.removeEventListener("input", this.onInput)
    aside.removeEventListener("change", this.onChange)
  }

  /**
   * Adds the parts of `parts` (the hook's `data-parts`) the editor does not have yet, with their
   * stored parameter overrides from `input`, to the working state and to every state of the
   * history. The parts it has keep their working state. Parts are only ever added, never removed.
   */
  addParts(parts, input) {
    const added = readParts(parts).filter(({name}) => !Object.hasOwn(this.state.parts, name))
    if (added.length === 0) return
    this.flushInput()
    const entries = added.map(({name, definition}) => [
      name,
      {definition, parameters: inputParameters(input, name)},
    ])
    // Each old state maps to one new state, so states that were the same object still are.
    const extended = new Map()
    const extend = state => {
      if (!extended.has(state)) {
        extended.set(state, {parts: {...state.parts, ...Object.fromEntries(entries)}})
      }
      return extended.get(state)
    }
    this.state = extend(this.state)
    this.history = {
      ...this.history,
      past: this.history.past.map(extend),
      present: extend(this.history.present),
      future: this.history.future.map(extend),
    }
    for (const [name, part] of entries) {
      this.order.push(name)
      this.stored.set(name, part)
      this.handles.set(name, new Handles(part.definition, controlPoints(part.definition)))
    }
  }

  /**
   * Stops the editor. Typing not evaluated yet is evaluated and committed, and every part that is
   * not stored is sent once more.
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
    // Saves go over one connection in order, so these never overtake one still in flight.
    for (const name of this.unsavedParts()) {
      const part = this.history.present.parts[name]
      if (!this.tooLarge(part)) this.pushSave(name, part)
    }
    this.unlisten(this.aside)
    window.removeEventListener("keydown", this.onKeyDown)
  }

  // ---- Evaluation and drawing ----

  /**
   * Takes the measurements of `input` (on mount and when the profile changes; the editor keeps
   * its own parameters and definitions) and returns the project result of the working state for
   * them, or null without input. The hook draws it.
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

  /**
   * Evaluates the project in `state`, with `offsets` ({part: {point: offset}}) replacing user
   * offsets; compiles again only when a definition changed.
   */
  evaluate(state, offsets = null) {
    const definitions = this.order.map(name => state.parts[name].definition)
    const compiledFor = this.compiledFor
    if (!compiledFor || definitions.some((definition, i) => definition !== compiledFor[i])) {
      this.compiled = compileProject(
        this.order.map((name, i) => ({name, definition: definitions[i]})),
      )
      this.compiledFor = definitions
    }
    const parameters = Object.fromEntries(
      this.order.map(name => [name, state.parts[name].parameters]),
    )
    const input = {measurements: this.measurements, parameters}
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

  // Called by the hook while it builds, moves and scales the drawing. `layers` holds one empty
  // SVG group per part, inside that part's translated group.
  drawHandles(layers, result) {
    for (const [name, layer] of layers) {
      const partResult = result.parts[name]
      if (partResult) this.handles.get(name)?.build(layer, partResult)
    }
  }

  moveHandles(result) {
    for (const [name, handles] of this.handles) {
      const partResult = result.parts[name]
      if (partResult) handles.update(partResult)
    }
  }

  scaleHandles(pixelsPerUnit) {
    for (const handles of this.handles.values()) handles.scale(pixelsPerUnit)
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
    this.panels.renderPoint(this.selectedPoint(), this.selected?.part)
    this.panels.renderParameters(this.state.parts)
    this.historyChanged()
    this.save()
  }

  /** The parts whose present state is not known to be stored, in project order. */
  unsavedParts() {
    const present = this.history.present.parts
    return this.order.filter(name => present[name] !== this.stored.get(name))
  }

  /** Saves the parts the history's present state changed: now, or as the saves in flight end. */
  save() {
    if (this.destroyed) return
    this.failed.clear()
    this.resends = 0
    if (this.pending.size === 0) this.send()
    else this.showStatus()
  }

  // Sends the first unsaved part that did not just fail with the same state. A part over a size
  // cap is not sent: it counts as failed and stays unsaved. Each save is answered once: by its
  // reply, or as failed after SAVE_TIMEOUT_MS, whichever comes first; the answer sends the next.
  send() {
    for (const name of this.unsavedParts()) {
      const part = this.history.present.parts[name]
      if (this.failed.get(name) === part) continue
      if (this.tooLarge(part)) {
        this.failed.set(name, part)
        continue
      }
      const token = ++this.nextToken
      this.pending.set(
        token,
        setTimeout(() => this.settle(token, name, part, false), SAVE_TIMEOUT_MS),
      )
      this.pushSave(name, part).then(
        reply => this.settle(token, name, part, reply?.ok === true),
        () => this.settle(token, name, part, false),
      )
      break
    }
    this.showStatus()
  }

  tooLarge({definition, parameters}) {
    const definitionBytes = encodedBytes(definition)
    return (
      definitionBytes > this.maxDefinitionBytes ||
      definitionBytes + encodedBytes(parameters) > this.maxSaveBytes
    )
  }

  pushSave(name, {definition, parameters}) {
    return this.hook.pushEvent("save_pattern", {part: name, definition, parameters})
  }

  // Answers the save `token` unless its reply or timeout already did, or a reconnect forgot it.
  settle(token, name, part, ok) {
    if (!this.pending.has(token)) return
    clearTimeout(this.pending.get(token))
    this.pending.delete(token)
    if (ok) {
      this.stored.set(name, part)
      this.failed.delete(name)
      this.resends = 0
    } else {
      this.failed.set(name, part)
    }
    // Parts committed while this save was in flight, or a newer state of this one.
    this.send()
  }

  // "saving" while a save is in flight, then "saved" or "failed".
  showStatus() {
    if (this.destroyed) return
    let status = "failed"
    if (this.pending.size > 0) status = "saving"
    else if (this.unsavedParts().length === 0) status = "saved"
    this.status = status
    this.panels.setStatus(status)
  }

  // Forgets the saves in flight: after a reconnect their replies will not come.
  forgetPending() {
    for (const timer of this.pending.values()) clearTimeout(timer)
    this.pending.clear()
  }

  /**
   * Saves the unsaved parts again (after a reconnect), after a delay that doubles with each
   * resend. Gives up after MAX_RESENDS in a row without a stored save, until the next commit.
   * The saves sent before the reconnect are forgotten: a late reply to one of them is ignored.
   */
  resendIfUnsaved() {
    if (this.destroyed) return
    this.forgetPending()
    if (this.resendTimer !== null) return
    if (this.unsavedParts().length === 0) {
      // A forgotten save may have left "saving" showing.
      if (this.status !== null) this.showStatus()
      return
    }
    if (this.resends >= MAX_RESENDS) {
      this.showStatus()
      return
    }
    const delay = RESEND_DELAY_MS * 2 ** this.resends
    this.resends++
    this.resendTimer = setTimeout(() => {
      this.resendTimer = null
      if (this.destroyed || this.pending.size > 0) return
      this.failed.clear()
      this.send()
    }, delay)
  }

  // ---- Selection ----

  /** The raw point `name` of part `part` in the working state, or undefined. */
  point(part, name) {
    if (!part || !name || !Object.hasOwn(this.state.parts, part)) return undefined
    return getPoint(this.state.parts[part].definition, name)
  }

  selectedPoint() {
    return this.selected ? this.point(this.selected.part, this.selected.name) : undefined
  }

  /** Selects the point `name` of part `part` (null for none) and shows it in the point panel. */
  select(part, name) {
    this.commit()
    const point = this.point(part, name)
    const selected = point ? {part, name} : null
    if (selected?.part === this.selected?.part && selected?.name === this.selected?.name) return
    this.selected = selected
    for (const [partName, handles] of this.handles) {
      handles.select(partName === selected?.part ? selected.name : null)
    }
    this.panels.renderPoint(point, selected?.part)
  }

  /** The point under a pointer event, {part, name}, or null. */
  pick(event) {
    if (!this.result) return null
    const at = this.hook.toUser(event.clientX, event.clientY)
    const radius = hitRadius(event.pointerType) / this.hook.pixelScale()
    let best = null
    for (const name of this.order) {
      const points = this.result.parts[name]?.points
      if (!points) continue
      const {dx, dy} = this.hook.partOffset(name)
      const local = {x: at.x - dx, y: at.y - dy}
      const prefer = this.selected?.part === name ? this.selected.name : undefined
      const point = pickPoint(points, local, radius, prefer)
      if (point === null) continue
      const distance = Math.hypot(points[point].x - local.x, points[point].y - local.y)
      if (!best || distance < best.distance || (distance === best.distance && prefer === point)) {
        best = {part: name, name: point, distance}
      }
    }
    return best && {part: best.part, name: best.name}
  }

  // ---- Dragging ----

  /**
   * A press with no other pointer down. On a point it selects it, starts a drag and returns
   * true: the hook then sends this pointer's moves and release here. Otherwise returns false and
   * the hook pans.
   */
  pointerDown(event) {
    const picked = this.pick(event)
    if (picked === null) return false
    this.cancelDrag()
    this.select(picked.part, picked.name)
    // The labels are placed at the drag's end instead.
    this.cancelLabels()
    this.drag = {
      part: picked.part,
      name: picked.name,
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
  // skipped: the drawing (and the offset that will be committed) stays the last good one. The
  // part's layout offset does not change during the drag, so screen deltas are part deltas.
  flushDrag(drag) {
    const client = drag.pending
    if (!client || drag !== this.drag) return
    drag.pending = null
    const at = this.hook.toUser(client.x, client.y)
    const offset = roundOffset({
      dx: drag.start.dx + at.x - drag.grab.x,
      dy: drag.start.dy + at.y - drag.grab.y,
    })
    const result = this.evaluate(this.state, {[drag.part]: {[drag.name]: offset}})
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
      ? withPart(
          this.state,
          drag.part,
          partWithDefinition(this.state, drag.part, this.offsetDefinition(drag)),
        )
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
    this.panels.renderPoint(this.selectedPoint(), this.selected?.part)
  }

  // The working definition of the dragged part with the dragged offset. Back at the start it is
  // the same object (no history step); an offset of (0, 0) removes the key, as the reset button
  // does.
  offsetDefinition({part, name, start, offset}) {
    const definition = this.state.parts[part].definition
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
      // Option values are `<part>.<point>`; part names have no dot.
      const value = target.value
      const dot = value.indexOf(".")
      if (dot < 0) this.select(null, null)
      else this.select(value.slice(0, dot), value.slice(dot + 1))
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
      if (!this.markIfNotSaved(target)) this.panels.renderParameter(row, this.state.parts)
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
    const selected = this.selected
    if (!selected || this.drag) return
    const definition = setPointFormula(
      this.state.parts[selected.part].definition,
      selected.name,
      field,
      text,
    )
    const state = withPart(
      this.state,
      selected.part,
      partWithDefinition(this.state, selected.part, definition),
    )
    if (state === this.state) {
      this.panels.setFieldError(field, null)
      return
    }
    const result = this.accept(state, "keep")
    this.panels.setFieldError(field, result.ok ? null : this.fieldErrorText(result, field))
  }

  // The text for the errors of an edit of `field` of the selected point: the field's own error,
  // else an error of the point as a whole (lines that do not meet), else the generic text (also
  // when the edit only breaks a part that imports from this one).
  fieldErrorText(result, field) {
    const {part, name} = this.selected
    const errors = result.parts[part]?.errors ?? []
    const own =
      errorsFor(errors, name, field)[0] ??
      errorsFor(errors, name).find(error => !("field" in error))
    return errorText(this.texts, own ?? null)
  }

  parameterRow(input) {
    const row = input.closest("[data-parameter]")
    if (!row) return null
    return this.panels
      .parameterRows()
      .find(r => r.part === row.dataset.part && r.name === row.dataset.parameter)
  }

  /**
   * A keystroke in a parameter field. Empty means the default; a value equal to the default is
   * not stored as an override.
   */
  parameterInput(row, text) {
    if (this.drag || !Object.hasOwn(this.state.parts, row.part)) return
    let value = null
    if (text.trim() !== "") {
      value = fromDisplay(text, row.unit)
      if (value === null) {
        this.panels.setParameterError(row, this.texts.errors?.parameter_format ?? "")
        return
      }
      if (value === row.default) value = null
    }
    const parameters = setParameter(this.state.parts[row.part].parameters, row.name, value)
    const state = withPart(this.state, row.part, partWithParameters(this.state, row.part, parameters))
    if (state === this.state) {
      this.panels.setParameterError(row, null)
      return
    }
    const result = this.accept(state, "keep")
    const errors = result.ok ? [] : (result.parts[row.part]?.errors ?? [])
    const own = errors.filter(error => error.name === row.name)
    const error = result.ok ? null : errorText(this.texts, own[0] ?? null)
    this.panels.setParameterError(row, error)
  }

  resetOffset() {
    const selected = this.selected
    if (!selected || this.drag) return
    this.commit()
    const definition = setUserOffset(this.state.parts[selected.part].definition, selected.name, null)
    const result = this.accept(
      withPart(this.state, selected.part, partWithDefinition(this.state, selected.part, definition)),
    )
    if (!result.ok) this.panels.setAlert(errorText(this.texts, null))
    this.commit()
    this.panels.renderPoint(this.selectedPoint(), selected.part)
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
