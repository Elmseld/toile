// Plane vector maths for the geometry engine. Pure numbers in millimetres, SVG coordinates
// (origin top left, y down). Angles are degrees, 0 = right, 90 = down, in `[0, 360)` (ADR 0004).

/** A position (or a vector) in millimetres. */
export type Point = { x: number; y: number };

/** Points closer than this (mm) count as coincident; also the tangent tolerance of a circle. */
export const EPSILON = 1e-9;

/**
 * The largest absolute coordinate (mm, i.e. 10 km) a computed point may have. Anything further out
 * is `degenerate_geometry`: no garment is that large, and bounded coordinates keep every derived
 * length, curve and SVG number finite.
 */
export const MAX_COORDINATE = 1e7;

/** Two lines are parallel when `|cross(d1, d2)| <= PARALLEL_TOLERANCE * |d1| * |d2|`. */
const PARALLEL_TOLERANCE = 1e-12;

const RAD_PER_DEG = Math.PI / 180;
const DEG_PER_RAD = 180 / Math.PI;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Point, factor: number): Point {
  return { x: v.x * factor, y: v.y * factor };
}

/** The length of vector `v`. */
export function norm(v: Point): number {
  return Math.hypot(v.x, v.y);
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * The unit vector at `degrees` (0 = right, 90 = down). Multiples of 90 degrees give exact axis
 * vectors, so a point drafted straight down from another keeps exactly the same `x`.
 */
export function direction(degrees: number): Point {
  const turned = ((degrees % 360) + 360) % 360;
  if (turned === 0) return { x: 1, y: 0 };
  if (turned === 90) return { x: 0, y: 1 };
  if (turned === 180) return { x: -1, y: 0 };
  if (turned === 270) return { x: 0, y: -1 };
  const radians = degrees * RAD_PER_DEG;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/**
 * The direction from `a` to `b` in degrees, `atan2(dy, dx)` in SVG coordinates normalised to
 * `[0, 360)`: 0 = right, 90 = down, 180 = left, 270 = up. `NaN` when the points coincide.
 */
export function angleOf(a: Point, b: Point): number {
  const d = sub(b, a);
  if (!(norm(d) >= EPSILON)) return Number.NaN;
  const degrees = Math.atan2(d.y, d.x) * DEG_PER_RAD;
  const normalised = degrees < 0 ? degrees + 360 : degrees;
  // A tiny negative angle plus 360 rounds to 360, which is outside the range; `+ 0` drops -0.
  return normalised >= 360 ? 0 : normalised + 0;
}

/**
 * The point at signed `distance` from `from` on the perpendicular to `from -> to` erected at
 * `from`. Positive lies at `angleOf(from, to) + 90`: the right-hand side when walking from `from`
 * to `to` (with y down), so for a line pointing right, positive is down. `null` when the points
 * coincide.
 */
export function perpendicularOffset(from: Point, to: Point, distance: number): Point | null {
  const d = sub(to, from);
  const length = norm(d);
  if (!(length >= EPSILON)) return null;
  return add(from, scale({ x: -d.y / length, y: d.x / length }, distance));
}

/**
 * The intersection of the infinite lines `a1 -> a2` and `b1 -> b2`, or `null` when they are
 * parallel (collinear included) or either line has coincident points.
 */
export function intersectLines(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d1 = sub(a2, a1);
  const d2 = sub(b2, b1);
  const denominator = cross(d1, d2);
  if (!(Math.abs(denominator) > PARALLEL_TOLERANCE * norm(d1) * norm(d2))) return null;
  const t = cross(sub(b1, a1), d2) / denominator;
  return add(a1, scale(d1, t));
}

/**
 * The intersections of the infinite line `a -> b` with the circle around `center`, ordered by the
 * parameter along `a -> b` (a tangent gives the same point twice). `null` when the line misses the
 * circle, the radius is negative or `a` and `b` coincide.
 */
export function intersectLineCircle(
  a: Point,
  b: Point,
  center: Point,
  radius: number,
): [Point, Point] | null {
  const d = sub(b, a);
  const length = norm(d);
  if (!(length >= EPSILON) || !(radius >= 0)) return null;
  const unit = scale(d, 1 / length);
  // Foot of the perpendicular from the center, then half the chord either side of it.
  const along = dot(sub(center, a), unit);
  const foot = add(a, scale(unit, along));
  const offset = distance(foot, center);
  // Compared in mm, not mm^2: `r^2 - offset^2` of an exact tangent with a large radius rounds to
  // far more than EPSILON either side of zero.
  if (offset > radius + EPSILON) return null;
  const half = Math.sqrt(Math.max(radius * radius - offset * offset, 0));
  return [add(foot, scale(unit, -half)), add(foot, scale(unit, half))];
}
