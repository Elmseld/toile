// Pure helpers for the pattern view's SVG viewBox. A view box is {x, y, width, height} in user
// units (millimetres). They only move and scale the view; no pattern geometry is computed here.

/** Narrowest view: 5 cm across. */
export const MIN_WIDTH = 50
/** Widest view: 20 m across. */
export const MAX_WIDTH = 20000

/**
 * The view box around `bounds` ({minX, minY, maxX, maxY}) plus `margin` on every side. A
 * degenerate or tiny pattern still gets a view of at least MIN_WIDTH, centred on it.
 */
export function fit(bounds, margin) {
  const width = Math.max(bounds.maxX - bounds.minX + 2 * margin, MIN_WIDTH)
  const height = Math.max(bounds.maxY - bounds.minY + 2 * margin, MIN_WIDTH)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return {x: cx - width / 2, y: cy - height / 2, width, height}
}

/**
 * Scales the view by `factor` (< 1 zooms in) around `point` in user units, which keeps its place
 * on screen. The width stays within MIN_WIDTH..MAX_WIDTH; the height scales by the same factor.
 */
export function zoomAt(viewBox, point, factor) {
  if (!Number.isFinite(factor) || factor <= 0) return viewBox
  const width = Math.min(Math.max(viewBox.width * factor, MIN_WIDTH), MAX_WIDTH)
  const applied = width / viewBox.width
  return {
    x: point.x - (point.x - viewBox.x) * applied,
    y: point.y - (point.y - viewBox.y) * applied,
    width,
    height: viewBox.height * applied,
  }
}

/** Moves the content by (dx, dy) user units: the view box moves the opposite way. */
export function panBy(viewBox, dx, dy) {
  return {...viewBox, x: viewBox.x - dx, y: viewBox.y - dy}
}

/** The centre of the view box, in user units. */
export function center(viewBox) {
  return {x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2}
}

/** The `viewBox` attribute value. */
export function toAttribute(viewBox) {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
}

/**
 * Path data for grid lines every `step` user units over `area` (a view box), aligned to
 * multiples of `step` so the lines stay on whole centimetres while panning.
 */
export function gridPathData(area, step) {
  const parts = []
  const top = area.y
  const bottom = area.y + area.height
  const left = area.x
  const right = area.x + area.width
  // Integer indices, so the positions do not drift by adding `step` repeatedly.
  for (let i = Math.ceil(left / step); i * step <= right; i++) {
    parts.push(`M${i * step} ${top}V${bottom}`)
  }
  for (let i = Math.ceil(top / step); i * step <= bottom; i++) {
    parts.push(`M${left} ${i * step}H${right}`)
  }
  return parts.join("")
}

/**
 * What an element of `widthPx` x `heightPx` shows of `viewBox` with
 * preserveAspectRatio="xMidYMid meet": the view box, widened in one direction to the element's
 * aspect ratio and centred. Also returns the scale in pixels per user unit.
 */
export function visibleArea(viewBox, widthPx, heightPx) {
  if (!(widthPx > 0 && heightPx > 0)) return {area: viewBox, scale: 0}
  const scale = Math.min(widthPx / viewBox.width, heightPx / viewBox.height)
  const width = widthPx / scale
  const height = heightPx / scale
  const c = center(viewBox)
  return {area: {x: c.x - width / 2, y: c.y - height / 2, width, height}, scale}
}
