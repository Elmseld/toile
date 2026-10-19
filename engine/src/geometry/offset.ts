// Offsetting for the cutting line (ADR 0007): single outline edges flattened and moved outwards.
// The joins at the corners between them are in `joins.ts`, the cleanup that keeps the outer
// boundary of a closed polyline that crosses itself in `boundary.ts`. Pure geometry in mm, SVG
// coordinates (y down). Engine-internal: exported for `seam-allowance.ts`, `darts.ts` and the
// tests, not from the package.
//
// Orientation: `sign` is the sign of the outline's signed area (`polygonArea`). Positive area in
// SVG coordinates is clockwise on screen; the outward normal of the unit tangent `t` is then
// `(t.y, -t.x)`, and `(-t.y, t.x)` for negative area.

import { cubicAt, cubicTangent } from "./bezier";
import { add, cross, dot, EPSILON, norm, type Point, scale, sub, unit } from "./vector";

/** Largest distance (mm) between a flattened curve and its chords, and between the sampled
 * offset of a cubic and its chords. */
export const FLATTEN_TOLERANCE = 0.01;
/** At most this many straight segments per cubic edge. */
export const MAX_CUBIC_SEGMENTS = 512;
/** At most this many straight segments for all the edges of one piece together. */
export const MAX_CUTTING_LINE_SEGMENTS = 20_000;

/** Consecutive points closer than this (mm) are merged into one. */
export const MERGE_TOLERANCE = 1e-6;

type EdgePoint = Readonly<Point>;

/** One outline edge, in the outline's direction of travel. */
export type Edge =
  | {
      readonly name: string;
      readonly type: "line";
      readonly from: EdgePoint;
      readonly to: EdgePoint;
    }
  | {
      readonly name: string;
      readonly type: "cubic";
      readonly from: EdgePoint;
      readonly c1: EdgePoint;
      readonly c2: EdgePoint;
      readonly to: EdgePoint;
    };


/** The signed area (shoelace) of the closed polygon; positive is clockwise on screen (y down). */
export function polygonArea(points: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/** The outward unit normal of unit tangent `tangent` for an outline whose area has sign `sign`. */
export function outwardNormal(tangent: Point, sign: number): Point {
  return sign > 0 ? { x: tangent.y, y: -tangent.x } : { x: -tangent.y, y: tangent.x };
}

/** The edge reversed: the same curve, travelled the other way. */
export function reverseEdge(edge: Edge): Edge {
  return edge.type === "line"
    ? { name: edge.name, type: "line", from: edge.to, to: edge.from }
    : { name: edge.name, type: "cubic", from: edge.to, c1: edge.c2, c2: edge.c1, to: edge.from };
}

/**
 * The number of straight segments that `offsetEdge` uses for `edge` at `allowance`: 1 for a line.
 * For a cubic, enough uniform parameter steps that the flattened curve is within
 * FLATTEN_TOLERANCE of the curve (`sqrt(0.75 M / tol)`, M the larger second difference of the
 * control points) and that each offset chord's sagitta from the turning of the normals is within
 * FLATTEN_TOLERANCE too (the control polygon's total turning divided by `sqrt(8 tol / allowance)`).
 * Between 1 and MAX_CUBIC_SEGMENTS.
 */
export function cubicSegments(edge: Edge, allowance: number): number {
  if (edge.type !== "cubic") return 1;
  const { from: p0, c1: p1, c2: p2, to: p3 } = edge;
  const m = Math.max(
    norm({ x: p0.x - 2 * p1.x + p2.x, y: p0.y - 2 * p1.y + p2.y }),
    norm({ x: p1.x - 2 * p2.x + p3.x, y: p1.y - 2 * p2.y + p3.y }),
  );
  const flat = Math.ceil(Math.sqrt((0.75 * m) / FLATTEN_TOLERANCE));
  const step = Math.sqrt((8 * FLATTEN_TOLERANCE) / Math.max(allowance, FLATTEN_TOLERANCE));
  const turned = Math.ceil(controlTurning(p0, p1, p2, p3) / step);
  const segments = Math.max(flat, turned, 1);
  return Number.isFinite(segments) ? Math.min(segments, MAX_CUBIC_SEGMENTS) : MAX_CUBIC_SEGMENTS;
}

/** The unit tangent of `edge` at its start (`0`) or end (`1`); `null` for a point-like edge. */
export function edgeTangent(edge: Edge, at: 0 | 1): Point | null {
  if (edge.type === "cubic") return cubicTangent(edge.from, edge.c1, edge.c2, edge.to, at);
  return unit(sub(edge.to, edge.from));
}

/**
 * The flattened edge: its start, `segments - 1` points at uniform parameter steps and its end
 * (just both ends for a line).
 */
export function flattenEdge(edge: Edge, segments: number): Point[] {
  if (edge.type !== "cubic") return [copy(edge.from), copy(edge.to)];
  const points: Point[] = [];
  for (let k = 0; k <= segments; k++) {
    points.push(cubicAt(edge.from, edge.c1, edge.c2, edge.to, k / segments));
  }
  return points;
}

/**
 * The edge moved `allowance` mm outwards (`sign` as in the module comment), as a polyline from
 * its start to its end. A line gives its two moved end points; a cubic `segments + 1` points at
 * uniform parameter steps, each moved along its own normal. On the concave side of a curve whose
 * radius is smaller than the allowance this polyline loops back; `outerBoundary` removes that.
 * Allowance 0 gives the flattened edge. Samples without a tangent (an interior cusp of a curve that
 * starts and ends at the same point) are left out.
 */
export function offsetEdge(
  edge: Edge,
  allowance: number,
  sign: number,
  segments: number = cubicSegments(edge, allowance),
): Point[] {
  if (edge.type !== "cubic") {
    const tangent = unit(sub(edge.to, edge.from));
    if (tangent === null) return [copy(edge.from)];
    const shift = scale(outwardNormal(tangent, sign), allowance);
    return [add(edge.from, shift), add(edge.to, shift)];
  }
  const points: Point[] = [];
  for (let k = 0; k <= segments; k++) {
    const t = k / segments;
    const point = cubicAt(edge.from, edge.c1, edge.c2, edge.to, t);
    if (allowance === 0) {
      points.push(point);
      continue;
    }
    const tangent = cubicTangent(edge.from, edge.c1, edge.c2, edge.to, t);
    if (tangent !== null) points.push(add(point, scale(outwardNormal(tangent, sign), allowance)));
  }
  return points;
}

// The total turning (radians) of the control polygon, skipping legs of zero length.
function controlTurning(p0: Point, p1: Point, p2: Point, p3: Point): number {
  const legs = [sub(p1, p0), sub(p2, p1), sub(p3, p2)].filter((leg) => norm(leg) >= EPSILON);
  let total = 0;
  for (let k = 1; k < legs.length; k++) {
    const u = legs[k - 1]!;
    const v = legs[k]!;
    total += Math.abs(Math.atan2(cross(u, v), dot(u, v)));
  }
  return total;
}

/** A fresh copy of `point` (callers mutate their arrays, never shared points). */
export function copy(point: Point): Point {
  return { x: point.x, y: point.y };
}
