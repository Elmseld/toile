// Cubic Bézier evaluation and arc length.

import { EPSILON, type Point } from "./vector";

/** The point at parameter `t` (0 to 1) of the cubic Bézier `p0, p1, p2, p3`. */
export function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

// 5-point Gauss-Legendre nodes and weights on [-1, 1].
const NODES = [
  -0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664,
] as const;
const WEIGHTS = [
  0.23692688505618908, 0.47862867049936647, 0.5688888888888889, 0.47862867049936647,
  0.23692688505618908,
] as const;

/** Equal sub-intervals of [0, 1] for the composite quadrature. */
const SUB_INTERVALS = 16;

/**
 * The arc length of the cubic Bézier `p0, p1, p2, p3` in mm: `|B'(t)|` integrated over [0, 1]
 * with composite 5-point Gauss-Legendre quadrature on 16 equal sub-intervals. Fixed cost (80
 * evaluations of the derivative), deterministic and without recursion, because it runs on every
 * pointer move during a drag (ADR 0004). Exact for straight cubics with evenly spaced controls,
 * whose speed is constant.
 */
export function cubicLength(p0: Point, p1: Point, p2: Point, p3: Point): number {
  return cubicLengthTo(p0, p1, p2, p3, 1);
}

/**
 * The arc length (mm) of the cubic from its start to parameter `t` (0 to 1), with the same
 * quadrature as `cubicLength` on `[0, t]`; `cubicLengthTo(..., 1)` is exactly `cubicLength`.
 */
export function cubicLengthTo(p0: Point, p1: Point, p2: Point, p3: Point, t: number): number {
  // B'(t) = 3 [(1-t)^2 (p1 - p0) + 2 (1-t) t (p2 - p1) + t^2 (p3 - p2)]
  const ax = p1.x - p0.x;
  const ay = p1.y - p0.y;
  const bx = p2.x - p1.x;
  const by = p2.y - p1.y;
  const cx = p3.x - p2.x;
  const cy = p3.y - p2.y;
  const half = (0.5 * t) / SUB_INTERVALS;

  let total = 0;
  for (let i = 0; i < SUB_INTERVALS; i++) {
    const mid = (2 * i + 1) * half;
    let sum = 0;
    for (let k = 0; k < NODES.length; k++) {
      const s = mid + half * (NODES[k] ?? 0);
      const u = 1 - s;
      const wa = u * u;
      const wb = 2 * u * s;
      const wc = s * s;
      const dx = wa * ax + wb * bx + wc * cx;
      const dy = wa * ay + wb * by + wc * cy;
      sum += (WEIGHTS[k] ?? 0) * Math.hypot(dx, dy);
    }
    total += sum * half;
  }
  return 3 * total;
}

/** The derivative `B'(t)` of the cubic (not normalised). */
function cubicDerivative(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const wa = 3 * u * u;
  const wb = 6 * u * t;
  const wc = 3 * t * t;
  return {
    x: wa * (p1.x - p0.x) + wb * (p2.x - p1.x) + wc * (p3.x - p2.x),
    y: wa * (p1.y - p0.y) + wb * (p2.y - p1.y) + wc * (p3.y - p2.y),
  };
}

/**
 * The direction of travel of the cubic at parameter `t`: its derivative, or, where that vanishes
 * (a control point on an end point, at that end), the chord `p3 - p0`. Not normalised; `(0, 0)`
 * only when the derivative and the chord both vanish.
 */
export function cubicTangent(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const derivative = cubicDerivative(p0, p1, p2, p3, t);
  if (Math.hypot(derivative.x, derivative.y) >= EPSILON) return derivative;
  return { x: p3.x - p0.x, y: p3.y - p0.y };
}

/** Arc lengths closer than this (mm) to the target end the search in `cubicParameterAtLength`. */
const LENGTH_TOLERANCE = 1e-4;
const MAX_LENGTH_STEPS = 60;

/**
 * The parameter `t` at which the cubic has run `length` mm from its start, within 0.01 mm of arc
 * length (in practice 1e-4 mm): Newton steps on `cubicLengthTo`, kept inside a bisection bracket
 * so a vanishing speed cannot throw them out. A length at or below 0 gives 0, one at or beyond the
 * curve's length gives 1.
 */
export function cubicParameterAtLength(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  length: number,
): number {
  const total = cubicLength(p0, p1, p2, p3);
  if (!(length > 0)) return 0;
  if (!(length < total)) return 1;
  let low = 0;
  let high = 1;
  let t = length / total;
  for (let step = 0; step < MAX_LENGTH_STEPS; step++) {
    const error = cubicLengthTo(p0, p1, p2, p3, t) - length;
    if (Math.abs(error) < LENGTH_TOLERANCE) return t;
    if (error > 0) high = t;
    else low = t;
    const derivative = cubicDerivative(p0, p1, p2, p3, t);
    const speed = Math.hypot(derivative.x, derivative.y);
    const next = speed > 0 ? t - error / speed : Number.NaN;
    t = next > low && next < high ? next : (low + high) / 2;
  }
  return t;
}
