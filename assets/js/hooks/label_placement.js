// Where the pattern view writes a piece's name: inside the piece, as far as possible from every
// drawn line (the outline, which includes the darts, and the grainline). Pure functions on the
// engine's computed pieces, in mm user units; no DOM. They only place text: the piece geometry
// itself comes from the engine.
//
// The text is treated as a box centred on the returned point (the view draws it with
// text-anchor="middle" and dominant-baseline="middle"), of `size` mm height and an estimated
// width. Candidate centres on a grid over the piece's bounding box are kept when they lie inside
// the outline; the one whose box is farthest from every line wins (of equally good centres, the
// one nearest the middle of the bounding box), refined once on a finer grid around it. A box that
// does not touch the outline and whose centre is inside lies wholly inside the piece. When no box at `size` keeps MIN_CLEARANCE_RATIO * size from the lines, the size
// shrinks step by step down to MIN_SIZE_RATIO * size. Deterministic (fixed grids and tie-break)
// and cheap: two grids of about 1700 and 300 candidates per size, against a few hundred segments.

// The engine's Bézier evaluation, not part of its public API but pure and stable.
import {cubicAt} from "../../../engine/src/geometry/bezier"

/** Straight segments per cubic when flattening an outline. */
export const CUBIC_STEPS = 16
/** Estimated advance of one character, as a fraction of the font size (generous for sans fonts). */
export const CHAR_WIDTH_RATIO = 0.62
/** Grid cells along each axis of the piece's bounding box in the first pass. */
const GRID_CELLS = 40
/** Cells per first-pass cell, each way, in the refining pass around the best candidate. */
const REFINE_CELLS = 8
/** Wanted gap between the text box and the nearest line, as a fraction of the font size. */
export const MIN_CLEARANCE_RATIO = 0.3
/** The smallest font size tried, as a fraction of the requested size. */
export const MIN_SIZE_RATIO = 0.4
const SHRINK_FACTOR = 0.85
/** Clearances closer than this (mm) count as equal; the candidate nearer the middle wins. */
const TIE_TOLERANCE = 0.01

/**
 * The outline of `piece` as a closed polygon (the last point is not repeated): the start of each
 * curve, with cubics sampled at CUBIC_STEPS - 1 inner points. Curves of an unknown type count as
 * straight lines between their ends.
 */
export function outlinePolygon(piece) {
  const points = []
  for (const curve of piece.outline) {
    points.push(curve.from)
    if (curve.type === "cubic") {
      for (let i = 1; i < CUBIC_STEPS; i++) points.push(cubicAt(curve.from, curve.c1, curve.c2, curve.to, i / CUBIC_STEPS))
    }
  }
  return points.filter(finitePoint)
}

/**
 * The text box of `text` at font `size`, centred on the origin: {width, height} in mm.
 */
export function textBox(text, size) {
  return {width: Math.max(1, [...text].length) * size * CHAR_WIDTH_RATIO, height: size}
}

/**
 * Where to draw the label `text` of `piece` and at which font size: {x, y, size, clearance}, with
 * (x, y) the centre of the text and `clearance` the distance in mm from its box to the nearest
 * line. `null` when no box, even at the smallest size, fits inside the piece without touching a
 * line (a sliver, or a degenerate or non-finite outline). Then the caller places it itself.
 */
export function placeLabel(piece, text, size) {
  const polygon = outlinePolygon(piece)
  if (polygon.length < 3) return null
  const segments = polygon.map((point, i) => [point, polygon[(i + 1) % polygon.length]])
  const {from, to} = piece.grainline
  if (finitePoint(from) && finitePoint(to)) segments.push([from, to])

  const bounds = boundsOf(polygon)
  const target = {x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2}
  let best = null
  for (const current of sizes(size)) {
    const found = bestCentre(polygon, segments, bounds, target, textBox(text, current))
    if (!found) continue
    const place = {x: found.x, y: found.y, size: current, clearance: found.clearance}
    if (found.clearance >= current * MIN_CLEARANCE_RATIO) return place
    if (!best || place.clearance > best.clearance) best = place
  }
  return best
}

// The font sizes to try, largest first: `size`, shrinking by SHRINK_FACTOR, ending at the minimum.
function sizes(size) {
  const minSize = size * MIN_SIZE_RATIO
  const result = []
  for (let current = size; current > minSize; current *= SHRINK_FACTOR) result.push(current)
  result.push(minSize)
  return result
}

// The candidate centre whose box is farthest from every segment, or null when no candidate is
// inside the polygon with its box clear of the lines. The grid has GRID_CELLS cells along each
// axis of the bounding box, so a narrow piece is sampled as finely across as along.
function bestCentre(polygon, segments, bounds, target, box) {
  const coarseStep = {
    x: (bounds.maxX - bounds.minX) / GRID_CELLS,
    y: (bounds.maxY - bounds.minY) / GRID_CELLS,
  }
  if (!(coarseStep.x > 0 && coarseStep.y > 0)) return null

  const coarse = scan(polygon, segments, target, box, bounds, coarseStep, null)
  if (!coarse) return null
  const around = {
    minX: coarse.x - coarseStep.x,
    minY: coarse.y - coarseStep.y,
    maxX: coarse.x + coarseStep.x,
    maxY: coarse.y + coarseStep.y,
  }
  const fineStep = {x: coarseStep.x / REFINE_CELLS, y: coarseStep.y / REFINE_CELLS}
  return scan(polygon, segments, target, box, around, fineStep, coarse)
}

// The best candidate on the grid over `area` (or `initial` if none beats it): the largest
// clearance; among clearances within TIE_TOLERANCE of each other, the one nearest `target` (the
// middle of the piece's bounding box), so a plateau of equally good centres gives its middle.
function scan(polygon, segments, target, box, area, step, initial) {
  let best = initial
  const columns = Math.round((area.maxX - area.minX) / step.x)
  const rows = Math.round((area.maxY - area.minY) / step.y)
  for (let row = 0; row <= rows; row++) {
    const y = area.minY + row * step.y
    for (let column = 0; column <= columns; column++) {
      const x = area.minX + column * step.x
      if (!insidePolygon(polygon, x, y)) continue
      const floor = best ? best.clearance - TIE_TOLERANCE : 0
      const clearance = boxClearance(segments, x, y, box, floor)
      if (clearance <= 0 || clearance < floor) continue
      const candidate = {x, y, clearance, offCentre: Math.hypot(x - target.x, y - target.y)}
      if (!best || better(candidate, best)) best = candidate
    }
  }
  return best
}

function better(candidate, best) {
  if (candidate.clearance > best.clearance + TIE_TOLERANCE) return true
  return candidate.clearance >= best.clearance - TIE_TOLERANCE && candidate.offCentre < best.offCentre
}

// The smallest distance from the box centred on (x, y) to any segment; 0 when one touches or
// crosses it. Stops early (returning a value below `floor`) once it cannot reach `floor`.
function boxClearance(segments, x, y, box, floor) {
  const rect = {
    minX: x - box.width / 2,
    minY: y - box.height / 2,
    maxX: x + box.width / 2,
    maxY: y + box.height / 2,
  }
  let nearest = Infinity
  for (const [a, b] of segments) {
    nearest = Math.min(nearest, rectSegmentDistance(rect, a, b))
    if (nearest < floor || nearest === 0) return nearest
  }
  return nearest
}

/** The distance from the axis-aligned box `rect` to the segment a-b; 0 when they meet. */
export function rectSegmentDistance(rect, a, b) {
  if (insideRect(rect, a) || insideRect(rect, b)) return 0
  const corners = [
    {x: rect.minX, y: rect.minY},
    {x: rect.maxX, y: rect.minY},
    {x: rect.maxX, y: rect.maxY},
    {x: rect.minX, y: rect.maxY},
  ]
  for (let i = 0; i < 4; i++) {
    if (segmentsCross(a, b, corners[i], corners[(i + 1) % 4])) return 0
  }
  let nearest = Math.min(pointRectDistance(a, rect), pointRectDistance(b, rect))
  for (const corner of corners) nearest = Math.min(nearest, pointSegmentDistance(corner, a, b))
  return nearest
}

/** Even-odd test of (x, y) against the closed polygon. */
export function insidePolygon(polygon, x, y) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const p = polygon[i]
    const q = polygon[j]
    if (p.y > y !== q.y > y && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) inside = !inside
  }
  return inside
}

function insideRect(rect, p) {
  return p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY
}

function pointRectDistance(p, rect) {
  const dx = Math.max(rect.minX - p.x, 0, p.x - rect.maxX)
  const dy = Math.max(rect.minY - p.y, 0, p.y - rect.maxY)
  return Math.hypot(dx, dy)
}

function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// Whether the segments p1-p2 and q1-q2 meet, touching included.
function segmentsCross(p1, p2, q1, q2) {
  const d1 = cross(q1, q2, p1)
  const d2 = cross(q1, q2, p2)
  const d3 = cross(p1, p2, q1)
  const d4 = cross(p1, p2, q2)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  return (
    (d1 === 0 && onSegment(q1, q2, p1)) ||
    (d2 === 0 && onSegment(q1, q2, p2)) ||
    (d3 === 0 && onSegment(p1, p2, q1)) ||
    (d4 === 0 && onSegment(p1, p2, q2))
  )
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSegment(a, b, p) {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  )
}

function boundsOf(points) {
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  return {minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys)}
}

function finitePoint(p) {
  return Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y)
}
