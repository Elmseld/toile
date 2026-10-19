// The joins of the cutting line at the outline's vertices (ADR 0007): miters, clipped miters,
// round joins, concave intersections and smooth steps between two offset edges. Pure geometry in
// mm, SVG coordinates (y down), orientation `sign` as in `offset.ts`. Engine-internal.

import { segmentsCross } from "./boundary";
import {
  copy,
  FLATTEN_TOLERANCE,
  MAX_CUBIC_SEGMENTS,
  MERGE_TOLERANCE,
  outwardNormal,
} from "./offset";
import {
  add,
  clamp01,
  cross,
  distance,
  dot,
  EPSILON,
  intersectLines,
  norm,
  type Point,
  pointSegmentDistance,
  scale,
  sub,
  unit,
} from "./vector";

/** A convex corner's miter reaches at most this many times the larger allowance from the corner. */
export const MITER_LIMIT = 4;
/** Edges that meet at no more than this angle (degrees) join without a corner. */
export const SMOOTH_JOIN_ANGLE = 0.5;
/** Corners within this angle (degrees) of a hairpin are classified by the flattened edges. */
const HAIRPIN_ANGLE = 10;
/** At most this many segments at each side of a concave corner are searched for the join. */
const MAX_JOIN_SEGMENTS = 256;

/**
 * How a concave corner is resolved: the first strand keeps its first `keepA` points, the second
 * strand drops its first `keepB` points, and both meet at `point`.
 */
export type ConcaveJoin = { point: Point; keepA: number; keepB: number };

/** An outline vertex where two offset edges meet, in the outline's direction of travel. */
export type Corner = {
  readonly vertex: Point;
  /** The end tangent (unit) and allowance of the edge that ends at the vertex. */
  readonly t1: Point;
  readonly a1: number;
  /** The start tangent (unit) and allowance of the edge that starts there. */
  readonly t2: Point;
  readonly a2: number;
  /** The sign of the outline's area (`offset.ts`). */
  readonly sign: number;
};

/** How `joinStrands` may join a corner. */
export type JoinOptions = {
  /** The flattened outline edges at the vertex: the one ending there, then the one starting. */
  readonly guard?: readonly (readonly Point[])[];
  /** Every convex corner round, concave corners only where the strands themselves cross. */
  readonly safe?: boolean;
};

/**
 * The points of the cutting line at `corner`, where an edge with end tangent `t1` and allowance
 * `a1` meets one with start tangent `t2` and allowance `a2`, and whether the corner is concave.
 * With `Q1 = vertex + a1 n(t1)` and `Q2 = vertex + a2 n(t2)` (the ends of the two offset edges):
 * - both allowances 0: `[vertex]`; `Q1` and `Q2` coincide: `[Q1]`;
 * - a smooth join (within SMOOTH_JOIN_ANGLE) of different allowances: the straight step
 *   `[Q1, Q2]`;
 * - a convex corner: `[Q1, miter, Q2]`, the miter being the intersection of the two offset tangent
 *   lines; farther than MITER_LIMIT times the larger allowance from the vertex, the miter is cut
 *   off square to the corner's bisector at that distance: `[Q1, C1, C2, Q2]`. Only a corner that
 *   turns by 90 degrees or more is cut off. One that turns less can only have such a far miter
 *   when its allowances differ widely (40 and 10 mm below about 11 degrees), and the miter then
 *   lies on the wider edge's offset line behind `Q1` (or beyond `Q2`), not out along the bisector.
 *   Such a corner gets the straight step `[Q1, Q2]` (a bevel, as SVG falls back to past its miter
 *   limit), which keeps at least the smaller allowance from the outline: the step lies between
 *   the two normals, where the vertex is the nearest outline point, and its nearest point to the
 *   vertex is the end with the smaller allowance;
 * - a concave corner: `[Q1, vertex, Q2]`. The overshoot lies inside the cut region; the caller
 *   resolves it with `concaveJoin` or leaves it to `outerBoundary`.
 * A smooth join of equal allowances follows the convex or concave rule, which there gives a point
 * within a hair of `Q1` and `Q2`: no visible corner. An exact hairpin (`t2 = -t1`) counts as
 * concave. `convex` overrides the tangents' verdict on the corner. Consecutive coincident points
 * are merged.
 */
export function joinCorner(
  corner: Corner,
  convex: boolean = cross(corner.t1, corner.t2) * corner.sign > 0,
): { points: Point[]; concave: boolean } {
  const { vertex, t1, a1, t2, a2, sign } = corner;
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
  // allowances on nearly parallel edges and lies behind the wider edge's end; squaring it off on
  // the bisector would reach far along the edges. The bevel keeps the smaller allowance.
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
 * Two offset strands joined at `corner`: `a` ends at its vertex (end tangent `t1`, allowance
 * `a1`), `b` starts there (`t2`, `a2`). Returns the new strands, whose concatenation is the joined
 * line: `a` with the corner points of `joinCorner` appended, or, at a concave corner, both strands
 * cut back (or extended) to the point where they meet (`concaveJoin`, within MITER_LIMIT times the
 * larger allowance of the vertex). When they do not meet there, the corner goes through the vertex
 * and `outerBoundary` cleans it up. Pass the same array as `a` and `b` for a single strand that
 * closes on itself; it is then never trimmed.
 *
 * `options.guard` holds the flattened outline edges at the vertex. The end tangent of a curve that
 * curls away right after the vertex can put a miter, or the meeting point of extended strands,
 * across the outline itself: such a miter becomes a round join (an arc around the vertex), and
 * such a meeting point is not used; so are miters and meeting points closer to those edges than
 * the smaller allowance. Within HAIRPIN_ANGLE of a hairpin, the tangents cannot tell a spike from
 * a slit, and the flattened edges decide whether the corner is convex. `options.safe` makes every
 * convex corner round and allows concave corners only where the strands themselves cross (no
 * extensions).
 */
export function joinStrands(
  a: readonly Point[],
  b: readonly Point[],
  corner: Corner,
  options: JoinOptions = {},
): { a: Point[]; b: Point[] } {
  const { guard = [], safe = false } = options;
  const { vertex, t1, a1, t2, a2, sign } = corner;
  const convex = hairpinTurn(corner, guard);
  const { points, concave } = joinCorner(corner, convex);
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
    points.length > 2 &&
    (safe || crossesAny(points, guard) || !clearOf(points, guard, clearance))
  ) {
    const n1 = outwardNormal(t1, sign);
    const n2 = outwardNormal(t2, sign);
    const round = roundJoin(vertex, n1, a1, n2, a2, unit(sub(t1, t2)) ?? undefined);
    return { a: [...a, ...round], b: [...b] };
  }
  return { a: [...a, ...points], b: [...b] };
}

// Near a hairpin, whether the corner is convex judging by the flattened edges at the vertex (their
// points next to it); undefined elsewhere or without them, leaving it to the tangents.
function hairpinTurn(
  { vertex, t1, t2, sign }: Corner,
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
