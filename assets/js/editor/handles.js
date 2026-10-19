// Handles: the editor's layer of point handles over the pattern drawing
// (docs/adr/0008-pattern-editor.md).
//
// Every computed point gets a small filled circle. The control points of cubic curves get a
// hollow circle and a thin dashed line to the curve end they belong to (c1 to `from`, c2 to
// `to`). The selected point is drawn larger in the primary colour. Sizes are in screen pixels:
// `scale(pixelsPerUnit)` converts them to user units (mm) whenever the view changes, and the
// strokes use `vector-effect="non-scaling-stroke"`.
//
// The layer only draws. It has `pointer-events="none"`; the hook finds the point under the
// pointer with the engine's `pickPoint` and `hitRadius`, so a handle is easy to hit with a finger
// even though it looks small.

const SVG_NS = "http://www.w3.org/2000/svg"

/** Handle radius in pixels. */
const POINT_RADIUS_PX = 3.5
/** Radius of the selected point in pixels. */
const SELECTED_RADIUS_PX = 6
/** How far from a point a press still picks it, in pixels, by pointer type. */
const HIT_RADIUS_PX = {mouse: 10, touch: 22, pen: 22}

/** How far from a point (in pixels) a press of `pointerType` still picks it. */
export function hitRadius(pointerType) {
  return HIT_RADIUS_PX[pointerType] ?? HIT_RADIUS_PX.touch
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  return element
}

/**
 * The guide lines of the cubic curves of a raw definition: `[control, end]` name pairs, c1 to
 * the curve's `from` and c2 to its `to`. Malformed curves are skipped (the engine reports them).
 */
function guidePairs(definition) {
  const curves = Array.isArray(definition?.curves) ? definition.curves : []
  const pairs = []
  for (const curve of curves) {
    if (curve?.type !== "cubic") continue
    const {from, c1, c2, to} = curve
    if (typeof c1 === "string" && typeof from === "string") pairs.push([c1, from])
    if (typeof c2 === "string" && typeof to === "string") pairs.push([c2, to])
  }
  return pairs
}

export class Handles {
  /**
   * @param {object} definition the raw definition (for the curves; names never change in an edit)
   * @param {Set<string>} controls the names of the control points (the engine's `controlPoints`)
   */
  constructor(definition, controls) {
    this.controls = controls
    this.pairs = guidePairs(definition)
    this.selected = null
    this.pixelsPerUnit = 1
    this.circles = new Map()
    this.lines = []
  }

  /** Builds the handles of `result` into `layer` (an empty SVG group), replacing any before. */
  build(layer, result) {
    this.circles = new Map()
    this.lines = []
    layer.replaceChildren()

    const guides = svgElement("g", {
      class: "text-base-content/50",
      stroke: "currentColor",
      "stroke-width": 1,
      "stroke-dasharray": "4 3",
      "vector-effect": "non-scaling-stroke",
    })
    for (const [control, end] of this.pairs) {
      const line = svgElement("line", {"vector-effect": "non-scaling-stroke"})
      this.lines.push({line, control, end})
      guides.appendChild(line)
    }
    layer.appendChild(guides)

    for (const name of Object.keys(result.points)) {
      const control = this.controls.has(name)
      const circle = svgElement("circle", {
        "data-point": name,
        class: this.classFor(name),
        "stroke-width": control ? 1.5 : 1,
        "vector-effect": "non-scaling-stroke",
      })
      this.circles.set(name, circle)
      layer.appendChild(circle)
    }

    this.update(result)
    this.markSelected()
    this.scale(this.pixelsPerUnit)
  }

  /** Moves the handles and guide lines to the points of `result`. */
  update(result) {
    const points = result.points
    for (const [name, circle] of this.circles) {
      const point = points[name]
      circle.setAttribute("visibility", point ? "visible" : "hidden")
      if (!point) continue
      circle.setAttribute("cx", point.x)
      circle.setAttribute("cy", point.y)
    }
    for (const {line, control, end} of this.lines) {
      const a = points[control]
      const b = points[end]
      line.setAttribute("visibility", a && b ? "visible" : "hidden")
      if (!a || !b) continue
      line.setAttribute("x1", a.x)
      line.setAttribute("y1", a.y)
      line.setAttribute("x2", b.x)
      line.setAttribute("y2", b.y)
    }
  }

  /** Sets the radii for a view of `pixelsPerUnit` pixels per millimetre. */
  scale(pixelsPerUnit) {
    if (!(pixelsPerUnit > 0)) return
    this.pixelsPerUnit = pixelsPerUnit
    for (const [name, circle] of this.circles) {
      const px = name === this.selected ? SELECTED_RADIUS_PX : POINT_RADIUS_PX
      circle.setAttribute("r", px / pixelsPerUnit)
    }
  }

  /** Highlights the point `name` (or none for `null`). */
  select(name) {
    if (name === this.selected) return
    const previous = this.selected
    this.selected = name
    this.markSelected(previous)
    this.scale(this.pixelsPerUnit)
  }

  markSelected(previous = null) {
    for (const name of [previous, this.selected]) {
      const circle = this.circles.get(name)
      if (!circle) continue
      circle.setAttribute("class", this.classFor(name))
      // The selected point is drawn last, over points that lie on it.
      if (name === this.selected) circle.parentNode?.appendChild(circle)
    }
  }

  classFor(name) {
    if (name === this.selected) return "fill-primary stroke-primary-content"
    return this.controls.has(name)
      ? "fill-base-100 stroke-base-content/70"
      : "fill-base-content/60 stroke-base-100"
  }
}
