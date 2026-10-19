// Darts in a piece outline and the cutting line across them (ADR 0007). Pure geometry in mm, SVG
// coordinates (y down). Engine-internal: exported for `seam-allowance.ts` and the tests.
//
// A dart is detected geometrically: two consecutive straight legs X -> A -> Y of (nearly) equal
// length, meeting at a concave apex A in a narrow wedge. Its cut edge is the "dart peak": the
// cutting line of the two neighbouring seams drawn with the dart closed and pressed toward the
// seam before it (S1), then unfolded. Closing rotates S2's side about A until leg A-Y lies on leg
// A-X. Pressed, the dart intake is a two-layer flap on S1's side between line A-X and the ray at
// half the dart angle beyond it; it is cut along the closed cutting line too. Unfolded, the layer
// at leg A-X is that cut reflected across A-X, and the layer at leg A-Y is that cut rotated back.

import { cubicSegments, type Edge, edgeTangent, joinStrands, offsetEdge, reverseEdge } from "./offset";
import {
  add,
  cross,
  distance,
  dot,
  intersectLines,
  type Point,
  reflectAcross,
  rotateAbout,
  scale,
  sub,
  unit,
} from "./vector";

/** The widest wedge (degrees) between two legs that counts as a dart. */
export const MAX_DART_ANGLE = 60;
/** Dart legs must be equal within the larger of `mm` and `ratio` times the longer leg. */
export const DART_LEG_TOLERANCE = { mm: 1, ratio: 0.02 } as const;

/** A dart found in an outline; indices are outline positions. */
export type Dart = {
  /** The seam before the dart (ends at `x`), its outline index and allowance owner. */
  readonly s1: Edge;
  readonly s1Index: number;
  /** The leg X -> A, at outline index `legIndex`, and the leg A -> Y after it. */
  readonly leg1: Edge;
  readonly leg2: Edge;
  readonly legIndex: number;
  /** The seam after the dart (starts at `y`). */
  readonly s2: Edge;
  readonly s2Index: number;
  readonly x: Point;
  readonly apex: Point;
  readonly y: Point;
};

/** Which seam the closed dart is pressed toward. Production uses `"before"` (S1). */
export type DartPress = "before" | "after";

/**
 * The darts of `outline` (`sign` is the sign of its area): outline entries `i` (X -> A) and
 * `i + 1` (A -> Y), cyclically, when the outline has at least four entries, both are lines, the
 * apex A is not convex, the wedge between A -> X and A -> Y is at most MAX_DART_ANGLE, the legs
 * are equal within DART_LEG_TOLERANCE, and none of the four entries (the seam before, the legs,
 * the seam after) belongs to a dart found earlier in outline order.
 */
export function findDarts(outline: readonly Edge[], sign: number): Dart[] {
  const n = outline.length;
  const darts: Dart[] = [];
  if (n < 4) return darts;
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    const indices = [(i + n - 1) % n, i, (i + 1) % n, (i + 2) % n] as const;
    if (indices.some((index) => used.has(index))) continue;
    const [s1Index, , legIndex2, s2Index] = indices;
    const leg1 = outline[i]!;
    const leg2 = outline[legIndex2]!;
    if (leg1.type !== "line" || leg2.type !== "line") continue;
    if (!isDart(leg1.from, leg1.to, leg2.to, sign)) continue;
    for (const index of indices) used.add(index);
    darts.push({
      s1: outline[s1Index]!,
      s1Index,
      leg1,
      leg2,
      legIndex: i,
      s2: outline[s2Index]!,
      s2Index,
      x: leg1.from,
      apex: leg1.to,
      y: leg2.to,
    });
  }
  return darts;
}

/**
 * The cutting line across `dart`, from the start of the offset seam before it (allowance `a1`)
 * to the end of the offset seam after it (`a2`): the dart peak (module comment). `segments` are
 * the flattening step counts of the two seams. When the seam before the dart is too short to
 * reach the flap's far edge, it is extended straight backwards along its start tangent to find
 * that edge (an approximation; the line still starts at the seam's offset start). Legs of unequal
 * length (within DART_LEG_TOLERANCE) are matched at their top ends X and Y. `null` when the
 * construction fails (no crossing of the closed cutting line with the dart's leg line or flap
 * edge); the caller then treats the dart's edges as ordinary edges.
 */
export function dartCuttingLine(
  dart: Dart,
  a1: number,
  a2: number,
  sign: number,
  press: DartPress = "before",
  segments: { s1: number; s2: number } = {
    s1: cubicSegments(dart.s1, a1),
    s2: cubicSegments(dart.s2, a2),
  },
): Point[] | null {
  if (press === "before") return pressedBefore(dart, a1, a2, sign, segments);
  const mirrored: Dart = {
    s1: reverseEdge(dart.s2),
    s1Index: dart.s2Index,
    leg1: reverseEdge(dart.leg2),
    leg2: reverseEdge(dart.leg1),
    legIndex: dart.legIndex,
    s2: reverseEdge(dart.s1),
    s2Index: dart.s1Index,
    x: dart.y,
    apex: dart.apex,
    y: dart.x,
  };
  const line = pressedBefore(mirrored, a2, a1, -sign, { s1: segments.s2, s2: segments.s1 });
  return line === null ? null : line.reverse();
}

// Whether X -> A -> Y is a dart (see findDarts).
function isDart(x: Point, apex: Point, y: Point, sign: number): boolean {
  const toX = sub(x, apex);
  const toY = sub(y, apex);
  const t1 = unit(sub(apex, x));
  const t2 = unit(toY);
  if (t1 === null || t2 === null) return false;
  if (cross(t1, t2) * sign > 0) return false;
  const angle = Math.atan2(Math.abs(cross(toX, toY)), dot(toX, toY));
  if (!(angle <= (MAX_DART_ANGLE * Math.PI) / 180)) return false;
  const l1 = distance(x, apex);
  const l2 = distance(apex, y);
  const tolerance = Math.max(DART_LEG_TOLERANCE.mm, DART_LEG_TOLERANCE.ratio * Math.max(l1, l2));
  return Math.abs(l1 - l2) <= tolerance;
}

function pressedBefore(
  dart: Dart,
  a1: number,
  a2: number,
  sign: number,
  segments: { s1: number; s2: number },
): Point[] | null {
  const { apex, x, y } = dart;
  const toY = unit(sub(y, apex));
  const toX = unit(sub(x, apex));
  const start1 = edgeTangent(dart.s1, 0);
  const end1 = edgeTangent(dart.s1, 1);
  const start2 = edgeTangent(dart.s2, 0);
  if (toY === null || toX === null || start1 === null || end1 === null || start2 === null) {
    return null;
  }
  // Closing: the rotation about A that takes ray A -> Y onto ray A -> X, then the shift that puts
  // Y exactly on X (zero for legs of equal length).
  const cos = dot(toY, toX);
  const sin = cross(toY, toX);
  const turn = (v: Point): Point => rotateAbout(v, { x: 0, y: 0 }, cos, sin);
  const shift = sub(x, rotateAbout(y, apex, cos, sin));
  const close = (p: Point): Point => add(rotateAbout(p, apex, cos, sin), shift);
  const open = (p: Point): Point => rotateAbout(sub(p, shift), apex, cos, -sin);

  const off1 = offsetEdge(dart.s1, a1, sign, segments.s1);
  const off2 = offsetEdge(dart.s2, a2, sign, segments.s2).map(close);
  const joined = joinStrands(off1, off2, x, end1, a1, turn(start2), a2, sign);
  const frame = [...joined.a, ...joined.b];

  const p = nearestLineCrossing(frame, apex, x);
  if (p === null) return null;
  const before = [...frame.slice(0, p.segment + 1), p.point];
  const after = [p.point, ...frame.slice(p.segment + 1)];

  // The flap's far edge: the ray from A half the dart angle beyond A -> X, on S1's side.
  const bisector = unit(add(toX, toY)) ?? toX;
  const edge = turn(bisector);
  const flap = flapCut(before, apex, edge, start1);
  if (flap === null) return null;

  return [
    ...before,
    ...[...flap].reverse().map((point) => reflectAcross(point, apex, x)),
    ...flap.map(open),
    ...after.map(open),
  ];
}

// The crossing of the polyline with the infinite line a-b that is nearest to b, with the index of
// the segment it is on.
function nearestLineCrossing(
  polyline: readonly Point[],
  a: Point,
  b: Point,
): { segment: number; point: Point } | null {
  const along = sub(b, a);
  let best: { segment: number; point: Point; distance: number } | null = null;
  for (let k = 0; k + 1 < polyline.length; k++) {
    const p = polyline[k]!;
    const q = polyline[k + 1]!;
    const dp = cross(along, sub(p, a));
    const dq = cross(along, sub(q, a));
    if (dp === 0 && dq === 0) continue;
    if ((dp < 0 && dq < 0) || (dp > 0 && dq > 0)) continue;
    const point = add(p, scale(sub(q, p), dp / (dp - dq)));
    const gap = distance(point, b);
    if (best === null || gap < best.distance) best = { segment: k, point, distance: gap };
  }
  return best === null ? null : { segment: best.segment, point: best.point };
}

// The part of `before` (the closed cutting line up to P) over the flap: from its last crossing
// with the ray from `apex` along `direction` to its end. When it does not reach the ray, its
// start is extended backwards along `startTangent` to meet it.
function flapCut(
  before: readonly Point[],
  apex: Point,
  direction: Point,
  startTangent: Point,
): Point[] | null {
  const far = add(apex, direction);
  for (let k = before.length - 2; k >= 0; k--) {
    const p = before[k]!;
    const q = before[k + 1]!;
    const hit = intersectLines(p, q, apex, far);
    if (hit === null) continue;
    const along = dot(sub(hit, p), sub(q, p)) / dot(sub(q, p), sub(q, p));
    if (along < 0 || along > 1 || dot(sub(hit, apex), direction) < 0) continue;
    return [hit, ...before.slice(k + 1)];
  }
  const first = before[0]!;
  const hit = intersectLines(first, add(first, startTangent), apex, far);
  if (hit === null) return null;
  if (dot(sub(hit, first), startTangent) > 0 || dot(sub(hit, apex), direction) < 0) return null;
  return [hit, ...before];
}
