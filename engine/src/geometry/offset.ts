// Offsetting for the cutting line (ADR 0007): single outline edges flattened and moved outwards,
// the joins at the corners between them, and the cleanup that keeps the outer boundary of a
// closed polyline that crosses itself. Pure geometry in mm, SVG coordinates (y down).
// Engine-internal: exported for `seam-allowance.ts`, `darts.ts` and the tests, not from the
// package.
//
// Orientation: `sign` is the sign of the outline's signed area (`polygonArea`). Positive area in
// SVG coordinates is clockwise on screen; the outward normal of the unit tangent `t` is then
// `(t.y, -t.x)`, and `(-t.y, t.x)` for negative area.

import { cubicAt, cubicTangent } from "./bezier";
import {
  add,
  cross,
  distance,
  dot,
  EPSILON,
  intersectLines,
  norm,
  type Point,
  scale,
  sub,
  unit,
} from "./vector";

/** Largest distance (mm) between a flattened curve and its chords, and between the sampled
 * offset of a cubic and its chords. */
export const FLATTEN_TOLERANCE = 0.01;
/** At most this many straight segments per cubic edge. */
export const MAX_CUBIC_SEGMENTS = 512;
/** At most this many straight segments for all the edges of one piece together. */
export const MAX_CUTTING_LINE_SEGMENTS = 20_000;
/** A convex corner's miter reaches at most this many times the larger allowance from the corner. */
export const MITER_LIMIT = 4;
/** Edges that meet at no more than this angle (degrees) join without a corner. */
export const SMOOTH_JOIN_ANGLE = 0.5;
/** Corners within this angle (degrees) of a hairpin are classified by the flattened edges. */
const HAIRPIN_ANGLE = 10;
/** Consecutive points closer than this (mm) are merged into one. */
export const MERGE_TOLERANCE = 1e-6;
/** At most this many segments at each side of a concave corner are searched for the join. */
const MAX_JOIN_SEGMENTS = 256;
/** Consecutive segments within this angle (radians) of straight on or straight back are merged. */
const SPIKE_TOLERANCE = 1e-9;

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

/** Where two strands of a closed polyline cross: segment `i` at `t`, segment `j` at `u`. */
export type Crossing = { i: number; t: number; j: number; u: number; point: Point };

/**
 * How a concave corner is resolved: the first strand keeps its first `keepA` points, the second
 * strand drops its first `keepB` points, and both meet at `point`.
 */
export type ConcaveJoin = { point: Point; keepA: number; keepB: number };

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

/**
 * The points of the cutting line at outline vertex `vertex`, where an edge with end tangent `t1`
 * and allowance `a1` meets one with start tangent `t2` and allowance `a2`. With
 * `Q1 = vertex + a1 n(t1)` and `Q2 = vertex + a2 n(t2)` (the ends of the two offset edges):
 * - both allowances 0: `[vertex]`; `Q1` and `Q2` coincide: `[Q1]`;
 * - a smooth join (within SMOOTH_JOIN_ANGLE) of different allowances: the straight step
 *   `[Q1, Q2]`;
 * - a convex corner: `[Q1, miter, Q2]`, the miter being the intersection of the two offset tangent
 *   lines; farther than MITER_LIMIT times the larger allowance from the vertex, the miter is cut
 *   off square to the corner's bisector at that distance: `[Q1, C1, C2, Q2]`. Only a corner that
 *   turns by 90 degrees or more is cut off; one that turns less can only have such a far miter
 *   when its allowances differ widely, and gets the straight step `[Q1, Q2]` instead;
 * - a concave corner: `[Q1, vertex, Q2]`. The overshoot lies inside the cut region; the caller
 *   resolves it with `concaveJoin` or leaves it to `outerBoundary`.
 * A smooth join of equal allowances follows the convex or concave rule, which there gives a point
 * within a hair of `Q1` and `Q2`: no visible corner. An exact hairpin (`t2 = -t1`) counts as
 * concave. Consecutive coincident points are merged.
 */
export function joinCorner(
  vertex: Point,
  t1: Point,
  a1: number,
  t2: Point,
  a2: number,
  sign: number,
): Point[] {
  return cornerJoin(vertex, t1, a1, t2, a2, sign).points;
}

/**
 * Two offset strands joined at outline vertex `vertex`: `a` ends there (end tangent `t1`,
 * allowance `a1`), `b` starts there (`t2`, `a2`). Returns the new strands, whose concatenation is
 * the joined line: `a` with the corner points of `joinCorner` appended, or, at a concave corner,
 * both strands cut back (or extended) to the point where they meet (`concaveJoin`, within
 * MITER_LIMIT times the larger allowance of the vertex). When they do not meet there, the corner
 * goes through the vertex and `outerBoundary` cleans it up. Pass the same array as `a` and `b`
 * for a single strand that closes on itself; it is then never trimmed.
 *
 * `guard` holds the flattened outline edges at the vertex. The end tangent of a curve that curls
 * away right after the vertex can put a miter, or the meeting point of extended strands, across
 * the outline itself: such a miter becomes a round join (an arc around the vertex), and such a
 * meeting point is not used; so are miters and meeting points closer to those edges than the
 * smaller allowance. Within HAIRPIN_ANGLE of a hairpin, the tangents cannot tell a spike from a
 * slit, and the flattened edges decide whether the corner is convex. `safe` makes every convex
 * corner round and allows concave corners only where the strands themselves cross (no
 * extensions).
 */
export function joinStrands(
  a: readonly Point[],
  b: readonly Point[],
  vertex: Point,
  t1: Point,
  a1: number,
  t2: Point,
  a2: number,
  sign: number,
  guard: readonly (readonly Point[])[] = [],
  safe = false,
): { a: Point[]; b: Point[] } {
  const convex = hairpinTurn(vertex, t1, t2, sign, guard);
  const { points: corner, concave } = cornerJoin(vertex, t1, a1, t2, a2, sign, convex);
  const clearance = Math.min(a1, a2) - 2 * FLATTEN_TOLERANCE;
  if (concave) {
    if (a !== b) {
      const limit = MITER_LIMIT * Math.max(a1, a2);
      const maxRank = safe ? 0 : 2;
      const join = concaveJoin(a, b, t1, t2, vertex, limit, { guard, maxRank, clearance });
      if (join !== null) {
        return { a: [...a.slice(0, join.keepA), join.point], b: b.slice(join.keepB) };
      }
    }
  } else if (
    corner.length > 2 &&
    (safe || crossesAny(corner, guard) || !clearOf(corner, guard, clearance))
  ) {
    const n1 = outwardNormal(t1, sign);
    const n2 = outwardNormal(t2, sign);
    const round = roundJoin(vertex, n1, a1, n2, a2, unit(sub(t1, t2)) ?? undefined);
    return { a: [...a, ...round], b: [...b] };
  }
  return { a: [...a, ...corner], b: [...b] };
}

// Near a hairpin, whether the corner is convex judging by the flattened edges at the vertex (their
// points next to it); undefined elsewhere or without them, leaving it to the tangents.
function hairpinTurn(
  vertex: Point,
  t1: Point,
  t2: Point,
  sign: number,
  guard: readonly (readonly Point[])[],
): boolean | undefined {
  if (!(dot(t1, t2) < 0) || Math.abs(cross(t1, t2)) > Math.sin((HAIRPIN_ANGLE * Math.PI) / 180)) {
    return undefined;
  }
  const [before, after] = guard;
  const previous = before?.[before.length - 2];
  const next = after?.[1];
  if (previous === undefined || next === undefined) return undefined;
  const turn = cross(sub(vertex, previous), sub(next, vertex));
  return turn === 0 ? undefined : turn * sign > 0;
}

// Whether the open polyline `path` stays at least `clearance` from every polyline of `others`.
function clearOf(
  path: readonly Point[],
  others: readonly (readonly Point[])[],
  clearance: number,
): boolean {
  if (!(clearance > 0)) return true;
  for (let i = 0; i + 1 < path.length; i++) {
    const p = path[i]!;
    const q = path[i + 1]!;
    for (const other of others) {
      for (let j = 0; j + 1 < other.length; j++) {
        if (segmentDistance(p, q, other[j]!, other[j + 1]!) < clearance) return false;
      }
    }
  }
  return true;
}

// The distance between segments p-q and r-s; 0 when they cross.
function segmentDistance(p: Point, q: Point, r: Point, s: Point): number {
  if (segmentsCross(p, q, r, s)) return 0;
  return Math.min(
    pointSegmentDistance(p, r, s),
    pointSegmentDistance(q, r, s),
    pointSegmentDistance(r, p, q),
    pointSegmentDistance(s, p, q),
  );
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const d = sub(b, a);
  const lengthSquared = dot(d, d);
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), d) / lengthSquared));
  return distance(p, add(a, scale(d, t)));
}

/**
 * The arc around `vertex` from `vertex + a1 n1` to `vertex + a2 n2`, its radius changing evenly
 * from `a1` to `a2`, flattened like an offset curve. It goes the short way round unless that
 * misses the direction `through` (the outward bisector of a corner, which decides at a hairpin).
 */
export function roundJoin(
  vertex: Point,
  n1: Point,
  a1: number,
  n2: Point,
  a2: number,
  through?: Point,
): Point[] {
  let angle = Math.atan2(cross(n1, n2), dot(n1, n2));
  const half = { x: Math.cos(angle / 2), y: Math.sin(angle / 2) };
  const middle = { x: n1.x * half.x - n1.y * half.y, y: n1.x * half.y + n1.y * half.x };
  if (through !== undefined && dot(middle, through) < 0) {
    angle += angle > 0 ? -2 * Math.PI : 2 * Math.PI;
  }
  const step = Math.sqrt((8 * FLATTEN_TOLERANCE) / Math.max(a1, a2, FLATTEN_TOLERANCE));
  const steps = Math.min(Math.max(1, Math.ceil(Math.abs(angle) / step)), MAX_CUBIC_SEGMENTS);
  const points: Point[] = [];
  for (let k = 0; k <= steps; k++) {
    const turn = (angle * k) / steps;
    const radius = a1 + ((a2 - a1) * k) / steps;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    points.push(add(vertex, scale({ x: n1.x * c - n1.y * s, y: n1.x * s + n1.y * c }, radius)));
  }
  return merged(points);
}

/** Whether the open polyline `path` crosses any of the polylines `others`, clear of rounding. */
export function crossesAny(path: readonly Point[], others: readonly (readonly Point[])[]): boolean {
  for (let i = 0; i + 1 < path.length; i++) {
    for (const other of others) {
      for (let j = 0; j + 1 < other.length; j++) {
        if (segmentsCross(path[i]!, path[i + 1]!, other[j]!, other[j + 1]!)) return true;
      }
    }
  }
  return false;
}

// joinCorner, also telling whether the corner is concave; `convex` overrides the tangents' verdict.
function cornerJoin(
  vertex: Point,
  t1: Point,
  a1: number,
  t2: Point,
  a2: number,
  sign: number,
  convex: boolean = cross(t1, t2) * sign > 0,
): { points: Point[]; concave: boolean } {
  if (a1 === 0 && a2 === 0) return { points: [copy(vertex)], concave: false };
  const n1 = outwardNormal(t1, sign);
  const n2 = outwardNormal(t2, sign);
  const q1 = add(vertex, scale(n1, a1));
  const q2 = add(vertex, scale(n2, a2));
  if (distance(q1, q2) < MERGE_TOLERANCE) return { points: [q1], concave: false };
  const turn = cross(t1, t2);
  const smooth = Math.atan2(Math.abs(turn), dot(t1, t2)) <= (SMOOTH_JOIN_ANGLE * Math.PI) / 180;
  if (smooth && a1 !== a2) return { points: [q1, q2], concave: false };
  if (!convex) return { points: merged([q1, copy(vertex), q2]), concave: true };

  const limit = MITER_LIMIT * Math.max(a1, a2);
  const miter = intersectLines(q1, add(q1, t1), q2, add(q2, t2));
  if (miter !== null && distance(miter, vertex) <= limit) {
    return { points: merged([q1, miter, q2]), concave: false };
  }
  // A far miter at a corner that turns by less than 90 degrees comes from very different
  // allowances on nearly parallel edges; squaring it off would reach far along the edges.
  if (dot(t1, t2) > 0) return { points: [q1, q2], concave: false };
  // Cut the miter off on the line square to the outward bisector at `limit` from the vertex. At a
  // convex corner, t1 - t2 points along that bisector, well defined even at a hairpin.
  const bisector = unit(sub(t1, t2));
  const along1 = bisector === null ? 0 : dot(t1, bisector);
  const along2 = bisector === null ? 0 : -dot(t2, bisector);
  if (bisector === null || !(along1 > EPSILON) || !(along2 > EPSILON)) {
    return { points: merged([q1, q2]), concave: false };
  }
  const c1 = add(q1, scale(t1, (limit - dot(sub(q1, vertex), bisector)) / along1));
  const c2 = sub(q2, scale(t2, (limit - dot(sub(q2, vertex), bisector)) / along2));
  return { points: merged([q1, c1, c2, q2]), concave: false };
}

/**
 * Where the strand `a` (ending at a concave corner) and the strand `b` (starting there) meet:
 * the intersection of their segments near the corner, each also extended straight beyond its
 * end by its end tangent (`t1` forward from the end of `a`, `t2` backward from the start of `b`).
 * Only intersections within `limit` of `vertex` count. A crossing of the strands themselves wins
 * over one that extends a strand, which wins over one that extends both (extended tangents of
 * curling curves can meet inside the piece); within that order, the one that removes or adds the
 * least length wins. A meeting point on an extension is skipped when the extension crosses the
 * `guard` polylines (the outline edges at the vertex) or comes closer to them than `clearance`,
 * and so is one that extends more than `maxRank` strands. `null` when there is none (the caller
 * then joins through the vertex). Looks at most MAX_JOIN_SEGMENTS segments of each strand.
 */
export function concaveJoin(
  a: readonly Point[],
  b: readonly Point[],
  t1: Point,
  t2: Point,
  vertex: Point,
  limit: number,
  options: {
    guard?: readonly (readonly Point[])[];
    maxRank?: number;
    clearance?: number;
  } = {},
): ConcaveJoin | null {
  const { guard = [], maxRank = 2, clearance = 0 } = options;
  const lastA = a[a.length - 1];
  const firstB = b[0];
  if (lastA === undefined || firstB === undefined || !(limit > 0)) return null;
  if (distance(lastA, firstB) < MERGE_TOLERANCE) {
    return { point: copy(lastA), keepA: a.length, keepB: 0 };
  }
  const reach = limit + distance(lastA, vertex) + distance(firstB, vertex);
  const box = {
    minX: vertex.x - limit,
    minY: vertex.y - limit,
    maxX: vertex.x + limit,
    maxY: vertex.y + limit,
  };

  // Candidate pieces of each strand: [start, end, keep, cost at start, cost at end], where the
  // cost is the length removed from (or added to) the strand when the join is there.
  type Piece = {
    p: Point;
    q: Point;
    keep: number;
    cost0: number;
    cost1: number;
    extended: boolean;
  };
  const piecesA: Piece[] = [
    {
      p: lastA,
      q: add(lastA, scale(t1, reach)),
      keep: a.length,
      cost0: 0,
      cost1: reach,
      extended: true,
    },
  ];
  let removed = 0;
  for (let k = a.length - 2; k >= Math.max(0, a.length - 1 - MAX_JOIN_SEGMENTS); k--) {
    const p = a[k]!;
    const q = a[k + 1]!;
    const length = distance(p, q);
    if (touchesBox(p, q, box)) {
      piecesA.push({ p, q, keep: k + 1, cost0: removed + length, cost1: removed, extended: false });
    }
    removed += length;
  }
  const piecesB: Piece[] = [
    {
      p: sub(firstB, scale(t2, reach)),
      q: firstB,
      keep: 0,
      cost0: reach,
      cost1: 0,
      extended: true,
    },
  ];
  removed = 0;
  for (let k = 0; k <= Math.min(b.length - 2, MAX_JOIN_SEGMENTS - 1); k++) {
    const p = b[k]!;
    const q = b[k + 1]!;
    const length = distance(p, q);
    if (touchesBox(p, q, box)) {
      piecesB.push({ p, q, keep: k + 1, cost0: removed, cost1: removed + length, extended: false });
    }
    removed += length;
  }

  let best: (ConcaveJoin & { cost: number; rank: number }) | null = null;
  for (const pa of piecesA) {
    for (const pb of piecesB) {
      const hit = segmentIntersection(pa.p, pa.q, pb.p, pb.q);
      if (hit === null || distance(hit.point, vertex) > limit) continue;
      const cost =
        pa.cost0 + (pa.cost1 - pa.cost0) * hit.t + pb.cost0 + (pb.cost1 - pb.cost0) * hit.u;
      const rank = Number(pa.extended) + Number(pb.extended);
      const better = best === null || rank < best.rank || (rank === best.rank && cost < best.cost);
      if (!better || rank > maxRank) continue;
      if (rank > 0 && crossesAny([pa.p, hit.point, pb.q], guard)) continue;
      const extensions = [
        ...(pa.extended ? [[pa.p, hit.point]] : []),
        ...(pb.extended ? [[hit.point, pb.q]] : []),
      ];
      if (extensions.some((path) => !clearOf(path, guard, clearance))) continue;
      best = { point: hit.point, keepA: pa.keep, keepB: pb.keep, cost, rank };
    }
  }
  return best === null ? null : { point: best.point, keepA: best.keepA, keepB: best.keepB };
}

/**
 * Every place where two non-adjacent segments of the closed polyline `loop` cross (segment `i`
 * runs from `loop[i]` to `loop[i + 1]`, the last one back to the start). A point exactly on a
 * segment's line counts as lying on its left (a consistent symbolic perturbation), so a crossing
 * through a vertex is found once, a touch is not a crossing and collinear overlaps are ignored.
 * Sweep over the segments sorted by their smallest x.
 */
export function findCrossings(loop: readonly Point[]): Crossing[] {
  const n = loop.length;
  const crossings: Crossing[] = [];
  if (n < 4) return crossings;
  const minX = new Float64Array(n);
  const maxX = new Float64Array(n);
  const minY = new Float64Array(n);
  const maxY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    minX[i] = Math.min(a.x, b.x);
    maxX[i] = Math.max(a.x, b.x);
    minY[i] = Math.min(a.y, b.y);
    maxY[i] = Math.max(a.y, b.y);
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => minX[p]! - minX[q]!);
  let active: number[] = [];
  for (const i of order) {
    active = active.filter((j) => maxX[j]! >= minX[i]!);
    for (const j of active) {
      if (maxY[j]! < minY[i]! || maxY[i]! < minY[j]!) continue;
      if (j === (i + 1) % n || i === (j + 1) % n) continue;
      const [first, second] = i < j ? [i, j] : [j, i];
      const crossing = properCrossing(loop, first, second);
      if (crossing !== null) crossings.push(crossing);
    }
    active.push(i);
  }
  return crossings;
}

/**
 * Whether an edge of closed polygon `a` crosses an edge of closed polygon `b`, clear of rounding
 * (touching and overlapping do not count). Sweep over both polygons' segments sorted by smallest x.
 */
export function polygonsCross(a: readonly Point[], b: readonly Point[]): boolean {
  type Segment = { p: Point; q: Point; minX: number; maxX: number; fromA: boolean };
  const segments: Segment[] = [];
  for (const [polygon, fromA] of [
    [a, true],
    [b, false],
  ] as const) {
    polygon.forEach((p, i) => {
      const q = polygon[(i + 1) % polygon.length]!;
      segments.push({ p, q, minX: Math.min(p.x, q.x), maxX: Math.max(p.x, q.x), fromA });
    });
  }
  segments.sort((s1, s2) => s1.minX - s2.minX);
  let active: Segment[] = [];
  for (const segment of segments) {
    active = active.filter((other) => other.maxX >= segment.minX);
    for (const other of active) {
      if (other.fromA !== segment.fromA && segmentsCross(segment.p, segment.q, other.p, other.q)) {
        return true;
      }
    }
    active.push(segment);
  }
  return false;
}

/**
 * The outer boundary of the closed polyline `loop`. At every crossing, walking forward on one
 * strand continues forward on the other; that splits `loop` into simple loops that do not cross
 * each other. Of those, the one with the largest area in the rotational direction of `loop` as a
 * whole is kept, starting at its leftmost point (smallest x, then smallest y). That drops
 * reversed loops (concave joins, the swallowtails of tight concave curves, a miter cut off by a
 * curling curve) and the overlap of lobes (allowances wider than a narrow part). A loop without
 * crossings is returned as it is. `null` when no loop has that direction (or, defensively, when
 * the walk exceeds its step bound).
 */
export function outerBoundary(loop: readonly Point[]): Point[] | null {
  const n = loop.length;
  if (n < 3) return null;
  const crossings = findCrossings(loop);
  if (crossings.length === 0) return loop.map(copy);
  const direction = Math.sign(polygonArea(loop));

  // Per segment, its crossings ordered along it; `slot[c]` is crossing c's place in each list.
  const events: { t: number; crossing: number; side: 0 | 1 }[][] = Array.from(
    { length: n },
    () => [],
  );
  crossings.forEach((c, index) => {
    events[c.i]!.push({ t: c.t, crossing: index, side: 0 });
    events[c.j]!.push({ t: c.u, crossing: index, side: 1 });
  });
  const slot = crossings.map(() => [0, 0]);
  for (const list of events) {
    list.sort((p, q) => p.t - q.t || p.crossing - q.crossing);
    list.forEach((event, k) => {
      slot[event.crossing]![event.side] = k;
    });
  }

  // A state (segment s, k) is the piece of segment s after its first k crossings. Each state has
  // exactly one successor and one predecessor, so following them visits every state in cycles.
  const offsets: number[] = [];
  let states = 0;
  for (const list of events) {
    offsets.push(states);
    states += list.length + 1;
  }
  const visited = new Uint8Array(states);
  let best: Point[] | null = null;
  let bestArea = 0;
  for (let first = 0; first < n; first++) {
    for (let k0 = 0; k0 <= events[first]!.length; k0++) {
      if (visited[offsets[first]! + k0]) continue;
      const cycle: Point[] = [];
      let segment = first;
      let next = k0;
      for (let steps = 0; !visited[offsets[segment]! + next]; steps++) {
        if (steps > states) return null;
        visited[offsets[segment]! + next] = 1;
        const event = events[segment]![next];
        if (event !== undefined) {
          const crossing = crossings[event.crossing]!;
          cycle.push(crossing.point);
          const other = event.side === 0 ? 1 : 0;
          segment = other === 0 ? crossing.i : crossing.j;
          next = slot[event.crossing]![other]! + 1;
        } else {
          segment = (segment + 1) % n;
          next = 0;
          cycle.push(loop[segment]!);
        }
      }
      const area = polygonArea(cycle) * direction;
      if (area > bestArea) {
        best = cycle;
        bestArea = area;
      }
    }
  }
  if (best === null) return null;
  const cleaned = cleanLoop(best);
  const start = leftmostIndex(cleaned);
  return [...cleaned.slice(start), ...cleaned.slice(0, start)];
}

/**
 * The closed polyline with consecutive points closer than MERGE_TOLERANCE merged (the last one
 * against the first too), and without the points where it goes straight on or turns straight back
 * onto itself (the tip of a needle).
 */
export function cleanLoop(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) pushPoint(out, point);
  // The seam between the last and the first point.
  for (let guard = out.length; guard > 0 && out.length >= 3; guard--) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (
      distance(first, last) < MERGE_TOLERANCE ||
      straightOrSpike(out[out.length - 2]!, last, first)
    ) {
      out.pop();
    } else if (straightOrSpike(last, first, out[1]!)) {
      out.shift();
    } else {
      break;
    }
  }
  return out;
}

/** The index of the leftmost point (smallest x, then smallest y); 0 for an empty list. */
export function leftmostIndex(points: readonly Point[]): number {
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const q = points[best]!;
    if (p.x < q.x || (p.x === q.x && p.y < q.y)) best = i;
  }
  return best;
}

// Appends `point` unless it coincides with the last one, first popping points that it makes
// straight or a spike.
function pushPoint(out: Point[], point: Point): void {
  for (;;) {
    const last = out[out.length - 1];
    if (last !== undefined && distance(last, point) < MERGE_TOLERANCE) return;
    const before = out[out.length - 2];
    if (last === undefined || before === undefined || !straightOrSpike(before, last, point)) break;
    out.pop();
  }
  out.push(copy(point));
}

// Whether a -> b -> c goes straight on or turns straight back at b: b can go.
function straightOrSpike(a: Point, b: Point, c: Point): boolean {
  const u = sub(b, a);
  const v = sub(c, b);
  return Math.abs(cross(u, v)) <= SPIKE_TOLERANCE * norm(u) * norm(v);
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

// Twice the signed area of the triangle a, b, c. Callers count zero (c on the line a-b) as
// positive: that is the symbolic perturbation of findCrossings.
function side(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// The crossing of segments i and j of `loop`, or null (see findCrossings for the rules).
function properCrossing(loop: readonly Point[], i: number, j: number): Crossing | null {
  const n = loop.length;
  const p1 = loop[i]!;
  const p2 = loop[(i + 1) % n]!;
  const q1 = loop[j]!;
  const q2 = loop[(j + 1) % n]!;
  const o1 = side(q1, q2, p1);
  const o2 = side(q1, q2, p2);
  if (o1 >= 0 === o2 >= 0) return null;
  const o3 = side(p1, p2, q1);
  const o4 = side(p1, p2, q2);
  if (o3 >= 0 === o4 >= 0) return null;
  const t = clamp01(o1 / (o1 - o2));
  const u = clamp01(o3 / (o3 - o4));
  return { i, t, j, u, point: add(p1, scale(sub(p2, p1), t)) };
}

// Whether segments p1-p2 and q1-q2 cross, each one's ends lying clearly (more than
// MERGE_TOLERANCE) on either side of the other's line: touching, overlapping and crossings within
// rounding of a shared line do not count.
function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  if (Math.max(p1.x, p2.x) < Math.min(q1.x, q2.x) || Math.max(q1.x, q2.x) < Math.min(p1.x, p2.x)) {
    return false;
  }
  if (Math.max(p1.y, p2.y) < Math.min(q1.y, q2.y) || Math.max(q1.y, q2.y) < Math.min(p1.y, p2.y)) {
    return false;
  }
  const lengthQ = distance(q1, q2);
  const lengthP = distance(p1, p2);
  const apart = (a: number, b: number, length: number): boolean =>
    (a > MERGE_TOLERANCE * length && b < -MERGE_TOLERANCE * length) ||
    (a < -MERGE_TOLERANCE * length && b > MERGE_TOLERANCE * length);
  return (
    apart(side(q1, q2, p1), side(q1, q2, p2), lengthQ) &&
    apart(side(p1, p2, q1), side(p1, p2, q2), lengthP)
  );
}

// The intersection of segments p1-p2 and q1-q2 (ends included), with its parameters on each.
function segmentIntersection(
  p1: Point,
  p2: Point,
  q1: Point,
  q2: Point,
): { point: Point; t: number; u: number } | null {
  const d1 = sub(p2, p1);
  const d2 = sub(q2, q1);
  const denominator = cross(d1, d2);
  if (!(Math.abs(denominator) > 1e-12 * norm(d1) * norm(d2))) return null;
  const offset = sub(q1, p1);
  const t = cross(offset, d2) / denominator;
  const u = cross(offset, d1) / denominator;
  const slack = 1e-9;
  if (t < -slack || t > 1 + slack || u < -slack || u > 1 + slack) return null;
  return { point: add(p1, scale(d1, clamp01(t))), t: clamp01(t), u: clamp01(u) };
}

function touchesBox(
  p: Point,
  q: Point,
  box: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return (
    Math.max(p.x, q.x) >= box.minX &&
    Math.min(p.x, q.x) <= box.maxX &&
    Math.max(p.y, q.y) >= box.minY &&
    Math.min(p.y, q.y) <= box.maxY
  );
}

function merged(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last === undefined || distance(last, point) >= MERGE_TOLERANCE) out.push(copy(point));
  }
  return out;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function copy(point: Point): Point {
  return { x: point.x, y: point.y };
}
