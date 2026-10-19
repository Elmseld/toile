// PatternView: draws a pattern project to scale in SVG, computed by the engine in the browser.
//
// Data attributes (set by ToileWeb.PatternLive.Show):
//   data-key           the measurement profile id; a change means new input
//   data-definition    the project's pattern definition (JSON, untrusted: the engine validates it)
//   data-input         {"measurements": {...}, "parameters": {...}} in millimetres (JSON)
//   data-piece-labels  {pieceName: label} (JSON)
//   data-error-text    shown instead of a drawing when the pattern cannot be computed
// The element's aria-label also names the SVG.
//
// Each piece's label is centred inside it where its text box is farthest from the outline, darts
// and grainline (the engine's placeLabel), and shrunk when the piece is too narrow for it. The
// grainline arrowheads are drawn at GRAINLINE_ARROW_SIZE, the size placeLabel keeps clear of.
//
// The SVG user unit is 1 mm. The pattern is computed once per input; zoom and pan only change
// the viewBox (and the grid lines that cover what is visible). Events on the element:
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
import {center, fit, gridPathData, panBy, toAttribute, visibleArea, zoomAt} from "./viewport"

const SVG_NS = "http://www.w3.org/2000/svg"
const FIT_MARGIN = 20
const LABEL_SIZE = 14
// Grid lines closer than this many pixels are not drawn (they would only grey the view).
const MIN_GRID_SPACING_PX = 4
const KEY_PAN_FRACTION = 0.1
const KEY_ZOOM_FACTOR = 0.8

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  return element
}

function parseJSON(text, fallback) {
  try {
    return JSON.parse(text ?? "")
  } catch {
    return fallback
  }
}

const PatternView = {
  mounted() {
    this.pointers = new Map()
    this.frame = null

    this.onWheel = event => this.wheel(event)
    this.onPointerDown = event => this.pointerDown(event)
    this.onPointerMove = event => this.pointerMove(event)
    this.onPointerUp = event => this.pointerUp(event)
    this.onKeyDown = event => this.keyDown(event)
    this.onFit = () => this.setView(this.fitted)
    this.onZoom = event => this.zoomBy(Number(event.detail?.factor))

    this.el.addEventListener("wheel", this.onWheel, {passive: false})
    this.el.addEventListener("pointerdown", this.onPointerDown)
    this.el.addEventListener("pointermove", this.onPointerMove)
    this.el.addEventListener("pointerup", this.onPointerUp)
    this.el.addEventListener("pointercancel", this.onPointerUp)
    this.el.addEventListener("lostpointercapture", this.onPointerUp)
    this.el.addEventListener("keydown", this.onKeyDown)
    this.el.addEventListener("toile:fit", this.onFit)
    this.el.addEventListener("toile:zoom", this.onZoom)

    // The grid covers what is visible, which depends on the element's size.
    this.resizeObserver = new ResizeObserver(() => this.scheduleRender())
    this.resizeObserver.observe(this.el)

    this.draw()
  },

  // phx-update="ignore" still patches data attributes; redraw when the input changed.
  updated() {
    if (this.drawnFrom !== this.source()) this.draw()
  },

  destroyed() {
    this.resizeObserver?.disconnect()
    if (this.frame !== null) cancelAnimationFrame(this.frame)
  },

  source() {
    const {key, definition, input} = this.el.dataset
    return `${key}\n${definition}\n${input}`
  },

  draw() {
    this.drawnFrom = this.source()
    this.pointers.clear()
    this.svg = null
    this.el.replaceChildren()

    const definition = parseJSON(this.el.dataset.definition, null)
    const input = parseJSON(this.el.dataset.input, null)
    const labels = parseJSON(this.el.dataset.pieceLabels, {})
    const result = input ? compilePattern(definition).evaluate(input) : null
    const bounds = result?.ok ? patternBounds(result) : null

    if (!result?.ok || !bounds) {
      if (result && !result.ok) console.warn("Pattern errors", result.errors)
      this.showError()
      return
    }

    this.fitted = fit(bounds, FIT_MARGIN)
    this.svg = this.buildSvg(result, labels)
    this.el.appendChild(this.svg)
    this.setView(this.fitted)
  },

  showError() {
    const message = document.createElement("p")
    message.setAttribute("role", "alert")
    message.className = "p-4 text-error"
    message.textContent = this.el.dataset.errorText ?? ""
    this.el.appendChild(message)
  },

  buildSvg(result, labels) {
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

    for (const piece of Object.values(result.pieces)) {
      const group = svgElement("g", {"data-piece": piece.name})
      group.appendChild(
        svgElement("path", {
          d: piecePathData(piece),
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 2,
          "stroke-linejoin": "round",
          "vector-effect": "non-scaling-stroke",
        }),
      )

      const {from, to} = piece.grainline
      group.appendChild(
        svgElement("line", {
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          stroke: "currentColor",
          "stroke-width": 1,
          "vector-effect": "non-scaling-stroke",
          "marker-start": `url(#${id}-arrow)`,
          "marker-end": `url(#${id}-arrow)`,
        }),
      )

      const text = labels[piece.name] ?? piece.name
      // Inside the piece, clear of the outline, darts and grainline (the engine's placeLabel); a
      // piece without area falls back to beside the grainline's midpoint.
      const place = placeLabel(piece, text, LABEL_SIZE) ?? {
        x: (from.x + to.x) / 2 + LABEL_SIZE / 2,
        y: (from.y + to.y) / 2,
        size: LABEL_SIZE,
      }
      const label = svgElement("text", {
        x: place.x,
        y: place.y,
        "font-size": place.size,
        fill: "currentColor",
        "text-anchor": "middle",
        "dominant-baseline": "middle",
      })
      label.textContent = text
      group.appendChild(label)
      svg.appendChild(group)
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
    this.el.setPointerCapture(event.pointerId)
    this.pointers.set(event.pointerId, {x: event.clientX, y: event.clientY})
  },

  pointerMove(event) {
    const previous = this.pointers.get(event.pointerId)
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
    this.pointers.delete(event.pointerId)
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
