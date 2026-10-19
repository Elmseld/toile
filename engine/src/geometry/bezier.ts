// Cubic Bézier evaluation and arc length.

import { type Point, sub, unit } from "./vector";

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
  // B'(t) = 3 [(1-t)^2 (p1 - p0) + 2 (1-t) t (p2 - p1) + t^2 (p3 - p2)]
  const ax = p1.x - p0.x;
  const ay = p1.y - p0.y;
  const bx = p2.x - p1.x;
  const by = p2.y - p1.y;
  const cx = p3.x - p2.x;
  const cy = p3.y - p2.y;
  const half = 0.5 / SUB_INTERVALS;

  let total = 0;
  for (let i = 0; i < SUB_INTERVALS; i++) {
    const mid = (2 * i + 1) * half;
    let sum = 0;
    for (let k = 0; k < NODES.length; k++) {
      const t = mid + half * (NODES[k] ?? 0);
      const u = 1 - t;
      const wa = u * u;
      const wb = 2 * u * t;
      const wc = t * t;
      const dx = wa * ax + wb * bx + wc * cx;
      const dy = wa * ay + wb * by + wc * cy;
      sum += (WEIGHTS[k] ?? 0) * Math.hypot(dx, dy);
    }
    total += sum * half;
  }
  return 3 * total;
}

/** The derivative `B'(t)` of the cubic Bézier `p0, p1, p2, p3` at parameter `t`. */
export function cubicDerivative(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  // B'(t) = 3 [(1-t)^2 (p1 - p0) + 2 (1-t) t (p2 - p1) + t^2 (p3 - p2)]
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return {
    x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
    y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
  };
}

/**
 * The unit tangent (direction of travel) of the cubic Bézier `p0, p1, p2, p3` at `t`. Where the
 * derivative vanishes because control points coincide with an end point, the limit direction is
 * used: `p2 - p0`, then `p3 - p0` at `t = 0`; `p3 - p1`, then `p3 - p0` at `t = 1`; `p3 - p0` at an
 * interior cusp. `null` only when all those vanish (every point coincides).
 */
export function cubicTangent(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point | null {
  const derivative = unit(cubicDerivative(p0, p1, p2, p3, t));
  if (derivative !== null) return derivative;
  if (t <= 0) return unit(sub(p2, p0)) ?? unit(sub(p3, p0));
  if (t >= 1) return unit(sub(p3, p1)) ?? unit(sub(p3, p0));
  return unit(sub(p3, p0));
}
