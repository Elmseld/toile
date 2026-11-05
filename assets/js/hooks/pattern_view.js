// PatternView: draws a pattern project to scale in SVG, computed by the engine in the browser.
//
// Data attributes (set by ToileWeb.PatternLive.Show):
//   data-key           the measurement profile id; a change means new input
//   data-parts         the project's parts, [{"name", "definition"}], main part first (JSON,
//                      untrusted: the engine validates it). The editor reads them on mount and
//                      only takes parts it does not have yet from a later value.
//   data-input         {"measurements": {...}, "parameters": {partName: {...}}} in millimetres (JSON)
//   data-piece-labels  {partName: {pieceName: label}} for the pieces of every part (JSON)
//   data-error-text    shown instead of a drawing when the pattern cannot be computed
//   data-editor        the id of the editor aside (optional); with it the pattern is editable
//   data-texts         the editor's UI texts (JSON, ToileWeb.EditorTexts)
//   data-max-save-bytes  the most a save's definition and parameters may encode to (JSON bytes)
//   data-max-definition-bytes  the most a save's definition alone may encode to (JSON bytes)
// The element's aria-label also names the SVG.
//
// All parts are evaluated together (the engine's compileProject), so a part that imports values
// from another, like a sleeve from the bodice armhole, is always computed from the same input. If
// any part fails, nothing is drawn. The parts are placed side by side by the engine's layoutParts
// when the drawing is built; each is drawn in a <g data-part> translated by its offset, and its
// pieces' notches as short marks into the piece. The layout stays while the pattern is edited, so
// a dragged point does not slip away from the pointer; it is redone on the next build.
//
// With an editor (assets/js/editor/pattern_editor.js, docs/adr/0008-pattern-editor.md) the
// editor owns the working definitions and parameters of all parts: compute() asks it for the
// result, it calls update() while points are dragged and edited, and it draws the point handles
// into a layer in each part's group. A press on a point is the editor's (drag); a press elsewhere
// pans as before, and a second pointer during a drag cancels the drag and pinches.
//
// Drawing has three parts: compute() evaluates the project for the current input, draw() builds
// the SVG elements once per input (and fits the view to them), and update() moves the existing
// elements to a new result without touching the view. updated() redraws only when data-key,
// data-parts or data-input changed.
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
  compileProject,
  layoutParts,
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
    this.drawn = this.source()
    this.pieceLabels = parseJSON(this.el.dataset.pieceLabels, {})
    this.parts = parseJSON(this.el.dataset.parts, null)
    // The pointer that drags a point, and where it last was (client pixels).
    this.dragPointer = null
    this.dragAt = null
    const input = parseJSON(this.el.dataset.input, null)
    this.editor = PatternEditor.create(this, this.parts, input)
    this.draw(this.compute(input))
  },

  // phx-update="ignore" still patches data attributes. New input (another profile) or new parts
  // (a part added) redraw. The editor keeps its working definitions and only takes new parts,
  // with their aside (data-editor names a new one when the parts change).
  updated() {
    const source = this.source()
    const drawn = this.drawn
    this.drawn = source
    const input = parseJSON(source.input, null)
    if (source.parts !== drawn.parts) {
      this.parts = parseJSON(source.parts, null)
      this.compiled = null
      this.editor?.addParts(this.parts, input)
    }
    // After addParts, so the new aside shows the new parts' values.
    if (source.editor !== drawn.editor && this.editor) {
      const aside = document.getElementById(source.editor)
      if (aside) this.editor.setAside(aside)
    }
    if (source.key === drawn.key && source.parts === drawn.parts && source.input === drawn.input) {
      return
    }
    this.pieceLabels = parseJSON(this.el.dataset.pieceLabels, {})
    this.draw(this.compute(input))
  },

  source() {
    const {key, parts, input, editor} = this.el.dataset
    return {key, parts, input, editor}
  },

  // Saves made while the connection was down are sent again.
  reconnected() {
    this.editor?.resendIfUnsaved()
  },

  // The editor sends the commits that are not stored yet once more before it goes (e.g. when
  // another profile lacks measurements and the drawing makes way for a message).
  destroyed() {
    this.editor?.destroy()
    this.resizeObserver?.disconnect()
    if (this.frame !== null) cancelAnimationFrame(this.frame)
  },

  // The project evaluated for `input`, or null without input. Compiles once per set of parts.
  // The editor evaluates its working state instead, with the measurements of `input`.
  compute(input) {
    if (this.editor) return this.editor.load(input)
    if (!input) return null
    this.compiled ??= compileProject(this.parts)
    return this.compiled.evaluate(input)
  },

  // Builds the drawing of `result` (a project result), lays the parts out and fits the view to
  // them (with fit: false it keeps the view it has, if any), or shows the error text when the
  // pattern cannot be drawn.
  draw(result, {fit: refit = true} = {}) {
    const view = refit ? null : this.viewBox
    this.editor?.cancelDrag()
    this.dragPointer = null
    this.pointers.clear()
    this.svg = null
    this.el.replaceChildren()

    const results = result?.ok ? Object.entries(result.parts) : []
    const layout = layoutParts(results.map(([, part]) => patternBounds(part)))
    if (!result?.ok || !layout.bounds) {
      if (result && !result.ok) console.warn("Pattern errors", this.errorsOf(result))
      this.showError()
      return
    }

    this.partOffsets = new Map(results.map(([name], i) => [name, layout.offsets[i]]))
    this.fitted = fit(layout.bounds, FIT_MARGIN)
    this.svg = this.buildSvg(result)
    this.el.appendChild(this.svg)
    this.update(result)
    this.setView(view ?? this.fitted)
  },

  // Moves the drawn elements to `result` (a result of the same parts) without changing the view
  // or the layout. With labels: "keep" the labels stay where they are, e.g. while a point is
  // dragged; "place" places them again. A result with other parts or pieces than the drawing is
  // drawn anew in the same view, and a result when nothing is drawn yet is drawn and fitted. A
  // result with errors changes nothing: the last good drawing stays.
  update(result, {labels = "place"} = {}) {
    if (!result?.ok) return
    if (!this.svg || !this.drawsPieces(result)) {
      this.draw(result, {fit: !this.svg})
      return
    }
    for (const [part, partResult] of Object.entries(result.parts)) {
      const pieces = this.pieceElements.get(part)
      for (const piece of Object.values(partResult.pieces)) {
        const elements = pieces.get(piece.name)
        const pathData = piecePathData(piece)
        elements.outline.setAttribute("d", pathData)
        const {from, to} = piece.grainline
        elements.grainline.setAttribute("x1", from.x)
        elements.grainline.setAttribute("y1", from.y)
        elements.grainline.setAttribute("x2", to.x)
        elements.grainline.setAttribute("y2", to.y)
        elements.notches.replaceChildren(...this.notchMarks(piece))
        if (labels === "place") this.placeLabelOf(piece, pathData, elements.label)
      }
    }
    this.editor?.moveHandles(result)
  },

  // Whether the drawing has exactly the parts and pieces of `result`.
  drawsPieces(result) {
    const parts = Object.entries(result.parts)
    if (parts.length !== this.pieceElements.size) return false
    return parts.every(([part, partResult]) => {
      const drawn = this.pieceElements.get(part)
      const names = Object.keys(partResult.pieces)
      return drawn && names.length === drawn.size && names.every(name => drawn.has(name))
    })
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

  // The short lines of a piece's notches.
  notchMarks(piece) {
    return piece.notches.flatMap(notch =>
      notch.marks.map(mark =>
        svgElement("line", {
          x1: mark.from.x,
          y1: mark.from.y,
          x2: mark.to.x,
          y2: mark.to.y,
          stroke: "currentColor",
          "stroke-width": 1.5,
          "stroke-linecap": "round",
          "vector-effect": "non-scaling-stroke",
        }),
      ),
    )
  },

  // The project's own errors and every part's, each tagged with its part name.
  errorsOf(result) {
    const partErrors = Object.entries(result.parts).flatMap(([part, partResult]) =>
      (partResult.errors ?? []).map(error => ({part, ...error})),
    )
    return [...result.errors, ...partErrors]
  },

  showError() {
    const message = document.createElement("p")
    message.setAttribute("role", "alert")
    message.className = "p-4 text-error"
    message.textContent = this.el.dataset.errorText ?? ""
    this.el.appendChild(message)
  },

  // The SVG with one group per part, translated by its layout offset, holding one group per
  // piece (outline, grainline, notches, label) and the part's handle layer, without geometry:
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
    const handleLayers = new Map()
    for (const [part, partResult] of Object.entries(result.parts)) {
      const offset = this.partOffsets.get(part)
      const partGroup = svgElement("g", {
        "data-part": part,
        transform: `translate(${offset.dx} ${offset.dy})`,
      })
      const labels = this.pieceLabels[part] ?? {}
      const pieces = new Map()
      for (const piece of Object.values(partResult.pieces)) {
        const elements = this.pieceGroup(piece.name, labels[piece.name] ?? piece.name)
        partGroup.appendChild(elements.group)
        pieces.set(piece.name, elements)
      }
      this.pieceElements.set(part, pieces)
      if (this.editor) {
        const layer = svgElement("g", {"data-handles": part, "pointer-events": "none"})
        partGroup.appendChild(layer)
        handleLayers.set(part, layer)
      }
      svg.appendChild(partGroup)
    }

    this.editor?.drawHandles(handleLayers, result)
    return svg
  },

  // The elements of one piece, without geometry.
  pieceGroup(name, text) {
    const id = this.el.id
    const group = svgElement("g", {"data-piece": name})
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
    const notches = svgElement("g")
    const label = svgElement("text", {
      fill: "currentColor",
      "dominant-baseline": "middle",
    })
    label.textContent = text
    group.append(outline, grainline, notches, label)
    return {group, outline, grainline, notches, label}
  },

  // Where part `part` is drawn: the offset its coordinates are moved by.
  partOffset(part) {
    return this.partOffsets?.get(part) ?? {dx: 0, dy: 0}
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
