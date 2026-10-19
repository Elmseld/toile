// PatternView: draws a pattern project to scale in SVG, computed by the engine in the browser.
//
// Data attributes (set by ToileWeb.PatternLive.Show):
//   data-key           the measurement profile id; a change means new input
//   data-definition    the project's pattern definition (JSON, untrusted: the engine validates it),
//                      read on mount only
//   data-input         {"measurements": {...}, "parameters": {...}} in millimetres (JSON)
//   data-piece-labels  {pieceName: label} (JSON)
//   data-error-text    shown instead of a drawing when the pattern cannot be computed
//   data-editor        the id of the editor aside (optional); with it the pattern is editable
//   data-texts         the editor's UI texts (JSON, ToileWeb.EditorTexts)
//   data-max-save-bytes  the most a save's definition and parameters may encode to (JSON bytes)
// The element's aria-label also names the SVG.
//
// With an editor (assets/js/editor/pattern_editor.js, docs/adr/0008-pattern-editor.md) the
// editor owns the working definition and parameters: compute() asks it for the result, it calls
// update() while points are dragged and edited, and it draws the point handles into a layer of
// the SVG. A press on a point is the editor's (drag); a press elsewhere pans as before, and a
// second pointer during a drag cancels the drag and pinches.
//
// Drawing has three parts: compute() evaluates the pattern for the current input, draw() builds
// the SVG elements once per input (and fits the view to them), and update() moves the existing
// elements to a new result without touching the view. updated() redraws only when data-key or
// data-input changed.
//
// Each piece's label is centred inside it where its text box is farthest from the outline, darts
// and grainline (the engine's placeLabel), and shrunk when the piece is too narrow for it. A
// placement costs several milliseconds, so placements are cached by label text, outline and
// grainline, and update(result, {labels: "keep"}) leaves the labels where they are. The grainline
// arrowheads are drawn at GRAINLINE_ARROW_SIZE, the size placeLabel keeps clear of.
//
// The SVG user unit is 1 mm. Zoom and pan only change the viewBox (and the grid lines that cover
// what is visible). Events on the element:
//   toile:fit                      resets the view to the whole pattern
//   toile:zoom {detail: {factor}}  zooms around the centre (factor < 1 zooms in)
// Wheel zooms around the pointer, two pointers pinch-zoom, one pointer pans, and with focus the
// arrow keys pan, + and - zoom and 0 fits.

import {
  GRAINLINE_ARROW_SIZE,
  compilePattern,
  patternBounds,
  piecePathData,
  placeLabel,
} from "../../../engine/src/index"
import {PatternEditor} from "../editor/pattern_editor"
import {parseJSON} from "../json"
import {center, fit, gridPathData, panBy, toAttribute, visibleArea, zoomAt} from "./viewport"

const SVG_NS = "http://www.w3.org/2000/svg"
const FIT_MARGIN = 20
const LABEL_SIZE = 14
// Grid lines closer than this many pixels are not drawn (they would only grey the view).
const MIN_GRID_SPACING_PX = 4
const KEY_PAN_FRACTION = 0.1
const KEY_ZOOM_FACTOR = 0.8
// Label placements kept before the cache starts over.
const LABEL_CACHE_SIZE = 200

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  return element
}

const PatternView = {
  mounted() {
    this.pointers = new Map()
    this.frame = null

    this.onWheel = event => this.wheel(event)
    this.onPointerDown = event => this.pointerDown(event)
    this.onPointerMove = event => this.pointerMove(event)
    this.onPointerUp = event => this.pointerUp(event)
    this.onPointerCancel = event => this.pointerCancel(event)
    this.onKeyDown = event => this.keyDown(event)
    this.onFit = () => this.setView(this.fitted)
    this.onZoom = event => this.zoomBy(Number(event.detail?.factor))

    this.el.addEventListener("wheel", this.onWheel, {passive: false})
    this.el.addEventListener("pointerdown", this.onPointerDown)
    this.el.addEventListener("pointermove", this.onPointerMove)
    this.el.addEventListener("pointerup", this.onPointerUp)
    this.el.addEventListener("pointercancel", this.onPointerCancel)
    this.el.addEventListener("lostpointercapture", this.onPointerCancel)
    this.el.addEventListener("keydown", this.onKeyDown)
    this.el.addEventListener("toile:fit", this.onFit)
    this.el.addEventListener("toile:zoom", this.onZoom)

    // The grid covers what is visible, which depends on the element's size.
    this.resizeObserver = new ResizeObserver(() => this.scheduleRender())
    this.resizeObserver.observe(this.el)

    this.labelCache = new Map()
    this.pieceLabels = parseJSON(this.el.dataset.pieceLabels, {})
    this.definition = parseJSON(this.el.dataset.definition, null)
    this.drawnKey = this.el.dataset.key
    this.drawnInput = this.el.dataset.input
    // The pointer that drags a point, and where it last was (client pixels).
    this.dragPointer = null
    this.dragAt = null
    const input = parseJSON(this.drawnInput, null)
    this.editor = PatternEditor.create(this, this.definition, input)
    this.draw(this.compute(input))
  },

  // phx-update="ignore" still patches data attributes. Only new input (another profile) redraws;
  // the definition is read on mount only.
  updated() {
    const {key, input} = this.el.dataset
    if (key === this.drawnKey && input === this.drawnInput) return
    this.drawnKey = key
    this.drawnInput = input
    this.draw(this.compute(parseJSON(input, null)))
  },

  // Saves made while the connection was down are sent again.
  reconnected() {
    this.editor?.resendIfUnsaved()
  },

  // The editor sends a commit that is not stored yet once more before it goes (e.g. when another
  // profile lacks measurements and the drawing makes way for a message).
  destroyed() {
    this.editor?.destroy()
    this.resizeObserver?.disconnect()
    if (this.frame !== null) cancelAnimationFrame(this.frame)
  },

  // The pattern evaluated for `input`, or null without input. Compiles once per definition. The
  // editor evaluates its working state instead, with the measurements of `input`.
  compute(input) {
    if (this.editor) return this.editor.load(input)
    if (!input) return null
    this.compiled ??= compilePattern(this.definition)
    return this.compiled.evaluate(input)
  },

  // Builds the drawing of `result` and fits the view to it (with fit: false it keeps the view it
  // has, if any), or shows the error text when the pattern cannot be drawn.
  draw(result, {fit: refit = true} = {}) {
    const view = refit ? null : this.viewBox
    this.editor?.cancelDrag()
    this.dragPointer = null
    this.pointers.clear()
    this.svg = null
    this.el.replaceChildren()

    const bounds = result?.ok ? patternBounds(result) : null
    if (!result?.ok || !bounds) {
      if (result && !result.ok) console.warn("Pattern errors", result.errors)
      this.showError()
      return
    }

    this.fitted = fit(bounds, FIT_MARGIN)
    this.svg = this.buildSvg(result)
    this.el.appendChild(this.svg)
    this.update(result)
    this.setView(view ?? this.fitted)
  },

  // Moves the drawn elements to `result` (a result of the same definition) without changing the
  // view. With labels: "keep" the labels stay where they are, e.g. while a point is dragged;
  // "place" places them again. A result with other pieces than the drawing is drawn anew in the
  // same view, and a result when nothing is drawn yet is drawn and fitted. A result with errors
  // changes nothing: the last good drawing stays.
  update(result, {labels = "place"} = {}) {
    if (!result?.ok) return
    if (!this.svg || !this.drawsPieces(result)) {
      this.draw(result, {fit: !this.svg})
      return
    }
    for (const piece of Object.values(result.pieces)) {
      const elements = this.pieceElements.get(piece.name)
      const pathData = piecePathData(piece)
      elements.outline.setAttribute("d", pathData)
      const {from, to} = piece.grainline
      elements.grainline.setAttribute("x1", from.x)
      elements.grainline.setAttribute("y1", from.y)
      elements.grainline.setAttribute("x2", to.x)
      elements.grainline.setAttribute("y2", to.y)
      if (labels === "place") this.placeLabelOf(piece, pathData, elements.label)
    }
    this.editor?.moveHandles(result)
  },

  drawsPieces(result) {
    const names = Object.keys(result.pieces)
    const drawn = this.pieceElements
    return names.length === drawn.size && names.every(name => drawn.has(name))
  },

  // Inside the piece, clear of the outline, darts and grainline (the engine's placeLabel),
  // centred on the returned point. A piece without area falls back to the grainline's midpoint,
  // start-anchored half a label height to its right so the text sits beside the line instead of
  // straddling it.
  placeLabelOf(piece, pathData, label) {
    const text = label.textContent
    const {from, to} = piece.grainline
    const key = `${text}\n${pathData}\n${from.x} ${from.y} ${to.x} ${to.y}`
    let place = this.labelCache.get(key)
    if (!place) {
      const placed = placeLabel(piece, text, LABEL_SIZE)
      place = placed
        ? {...placed, anchor: "middle"}
        : {
            x: (from.x + to.x) / 2 + LABEL_SIZE / 2,
            y: (from.y + to.y) / 2,
            size: LABEL_SIZE,
            anchor: "start",
          }
      if (this.labelCache.size >= LABEL_CACHE_SIZE) this.labelCache.clear()
      this.labelCache.set(key, place)
    }
    label.setAttribute("x", place.x)
    label.setAttribute("y", place.y)
    label.setAttribute("font-size", place.size)
    label.setAttribute("text-anchor", place.anchor)
  },

  showError() {
    const message = document.createElement("p")
    message.setAttribute("role", "alert")
    message.className = "p-4 text-error"
    message.textContent = this.el.dataset.errorText ?? ""
    this.el.appendChild(message)
  },

  // The SVG with one group per piece of `result` (outline, grainline, label), without geometry:
  // update() sets that.
  buildSvg(result) {
    const id = this.el.id
    const svg = svgElement("svg", {
      class: "block size-full text-base-content",
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": this.el.getAttribute("aria-label") ?? "",
    })

    const defs = svgElement("defs")
    const arrow = svgElement("marker", {
      id: `${id}-arrow`,
      viewBox: "0 0 10 10",
      refX: 10,
      refY: 5,
      markerUnits: "userSpaceOnUse",
      markerWidth: GRAINLINE_ARROW_SIZE,
      markerHeight: GRAINLINE_ARROW_SIZE,
      orient: "auto-start-reverse",
    })
    arrow.appendChild(svgElement("path", {d: "M0 0L10 5L0 10z", fill: "currentColor"}))
    defs.appendChild(arrow)
    svg.appendChild(defs)

    const gridStyle = {fill: "none", stroke: "currentColor", "vector-effect": "non-scaling-stroke"}
    this.minorGrid = svgElement("path", {...gridStyle, "stroke-opacity": 0.08, "stroke-width": 1})
    this.majorGrid = svgElement("path", {...gridStyle, "stroke-opacity": 0.25, "stroke-width": 1})
    svg.appendChild(this.minorGrid)
    svg.appendChild(this.majorGrid)

    this.pieceElements = new Map()
    for (const piece of Object.values(result.pieces)) {
      const group = svgElement("g", {"data-piece": piece.name})
      const outline = svgElement("path", {
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 2,
        "stroke-linejoin": "round",
        "vector-effect": "non-scaling-stroke",
      })
      const grainline = svgElement("line", {
        stroke: "currentColor",
        "stroke-width": 1,
        "vector-effect": "non-scaling-stroke",
        "marker-start": `url(#${id}-arrow)`,
        "marker-end": `url(#${id}-arrow)`,
      })
      const label = svgElement("text", {
        fill: "currentColor",
        "dominant-baseline": "middle",
      })
      label.textContent = this.pieceLabels[piece.name] ?? piece.name
      group.append(outline, grainline, label)
      svg.appendChild(group)
      this.pieceElements.set(piece.name, {outline, grainline, label})
    }

    if (this.editor) {
      const handles = svgElement("g", {id: `${id}-handles`, "pointer-events": "none"})
      svg.appendChild(handles)
      this.editor.drawHandles(handles, result)
    }

    return svg
  },

  setView(viewBox) {
    if (!this.svg || !viewBox) return
    this.viewBox = viewBox
    this.scheduleRender()
  },

  // Batches view changes from pointer and wheel events into one update per frame.
  scheduleRender() {
    if (this.frame !== null || !this.svg) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      this.render()
    })
  },

  render() {
    if (!this.svg) return
    this.svg.setAttribute("viewBox", toAttribute(this.viewBox))
    const {width, height} = this.svg.getBoundingClientRect()
    const {area, scale} = visibleArea(this.viewBox, width, height)
    this.minorGrid.setAttribute("d", this.gridAt(area, scale, 10))
    this.majorGrid.setAttribute("d", this.gridAt(area, scale, 100))
    this.editor?.scaleHandles(scale)
  },

  gridAt(area, scale, step) {
    return step * scale >= MIN_GRID_SPACING_PX ? gridPathData(area, step) : ""
  },

  // A screen position (client pixels) in user units of the current view. Computed from
  // this.viewBox rather than getScreenCTM(), which lags behind until the next frame renders.
  toUser(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect()
    const {scale} = visibleArea(this.viewBox, rect.width, rect.height)
    const c = center(this.viewBox)
    if (!scale) return c
    return {
      x: c.x + (clientX - (rect.left + rect.width / 2)) / scale,
      y: c.y + (clientY - (rect.top + rect.height / 2)) / scale,
    }
  },

  // Pixels per user unit of the current view.
  pixelScale() {
    const {width, height} = this.svg.getBoundingClientRect()
    return visibleArea(this.viewBox, width, height).scale || 1
  },

  zoomBy(factor) {
    if (!this.svg) return
    this.setView(zoomAt(this.viewBox, center(this.viewBox), factor))
  },

  wheel(event) {
    if (!this.svg) return
    event.preventDefault()
    // Line and page deltas (Firefox) to pixels; trackpad pinches arrive as wheel + ctrlKey.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.el.clientHeight : 1
    const speed = event.ctrlKey ? 0.01 : 0.001
    const factor = Math.exp(event.deltaY * unit * speed)
    this.setView(zoomAt(this.viewBox, this.toUser(event.clientX, event.clientY), factor))
  },

  pointerDown(event) {
    if (!this.svg || (event.pointerType === "mouse" && event.button !== 0)) return
    const at = {x: event.clientX, y: event.clientY}
    if (this.dragPointer !== null) {
      // A second pointer during a drag: the point goes back, and the two pointers pinch.
      this.editor.cancelDrag()
      this.pointers.set(this.dragPointer, this.dragAt)
      this.dragPointer = null
    } else if (this.pointers.size === 0 && this.editor?.pointerDown(event)) {
      this.el.setPointerCapture(event.pointerId)
      this.dragPointer = event.pointerId
      this.dragAt = at
      return
    }
    this.el.setPointerCapture(event.pointerId)
    this.pointers.set(event.pointerId, at)
  },

  // The editor cancelled the drag (Escape) while its pointer is still down: that pointer pans.
  dragCancelled() {
    if (this.dragPointer === null) return
    this.pointers.set(this.dragPointer, this.dragAt)
    this.dragPointer = null
  },

  pointerMove(event) {
    if (event.pointerId === this.dragPointer) {
      this.dragAt = {x: event.clientX, y: event.clientY}
      this.editor.moveDrag(event)
      return
    }
    const previous = this.pointers.get(event.pointerId)
    if (!previous) this.hover(event)
    if (!previous || !this.svg) return
    const current = {x: event.clientX, y: event.clientY}

    if (this.pointers.size === 1) {
      const scale = this.pixelScale()
      this.setView(panBy(this.viewBox, (current.x - previous.x) / scale, (current.y - previous.y) / scale))
    } else if (this.pointers.size === 2) {
      const [other] = [...this.pointers].filter(([id]) => id !== event.pointerId).map(([, p]) => p)
      this.pinch(previous, current, other)
    }

    this.pointers.set(event.pointerId, current)
  },

  // One finger of a pinch moved from `previous` to `current` while the other stayed at `other`:
  // pan by the midpoint's move, then zoom around the new midpoint by the change in distance.
  pinch(previous, current, other) {
    const before = Math.hypot(previous.x - other.x, previous.y - other.y)
    const after = Math.hypot(current.x - other.x, current.y - other.y)
    if (before < 1 || after < 1) return

    const scale = this.pixelScale()
    const midBefore = {x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2}
    const midAfter = {x: (current.x + other.x) / 2, y: (current.y + other.y) / 2}
    const panned = panBy(
      this.viewBox,
      (midAfter.x - midBefore.x) / scale,
      (midAfter.y - midBefore.y) / scale,
    )
    this.viewBox = panned
    const point = this.toUser(midAfter.x, midAfter.y)
    this.setView(zoomAt(panned, point, before / after))
  },

  pointerUp(event) {
    if (event.pointerId === this.dragPointer) {
      this.dragPointer = null
      this.editor.endDrag()
      return
    }
    this.pointers.delete(event.pointerId)
  },

  // The browser took the pointer away (or capture was lost): a drag ends without a change.
  pointerCancel(event) {
    if (event.pointerId === this.dragPointer) {
      this.dragPointer = null
      this.editor.cancelDrag()
      return
    }
    this.pointers.delete(event.pointerId)
  },

  // A mouse over a point shows the move cursor.
  hover(event) {
    if (event.pointerType !== "mouse" || !this.svg || !this.editor) return
    this.el.classList.toggle("cursor-move", this.editor.pick(event) !== null)
  },

  keyDown(event) {
    if (!this.svg || event.altKey || event.ctrlKey || event.metaKey) return
    const step = KEY_PAN_FRACTION * Math.min(this.viewBox.width, this.viewBox.height)
    const actions = {
      ArrowLeft: () => this.setView(panBy(this.viewBox, step, 0)),
      ArrowRight: () => this.setView(panBy(this.viewBox, -step, 0)),
      ArrowUp: () => this.setView(panBy(this.viewBox, 0, step)),
      ArrowDown: () => this.setView(panBy(this.viewBox, 0, -step)),
      "+": () => this.zoomBy(KEY_ZOOM_FACTOR),
      "=": () => this.zoomBy(KEY_ZOOM_FACTOR),
      "-": () => this.zoomBy(1 / KEY_ZOOM_FACTOR),
      "0": () => this.setView(this.fitted),
    }
    const action = actions[event.key]
    if (action) {
      event.preventDefault()
      action()
    }
  },
}

export default PatternView
