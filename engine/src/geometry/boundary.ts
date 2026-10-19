// The outer boundary of a closed polyline that crosses itself, and the crossing tests behind it
// (ADR 0007). Pure geometry in mm, SVG coordinates (y down). Engine-internal.

import { copy, MERGE_TOLERANCE, polygonArea } from "./offset";
import { add, clamp01, cross, distance, norm, type Point, scale, sub } from "./vector";

/** Consecutive segments within this angle (radians) of straight on or straight back are merged. */
const SPIKE_TOLERANCE = 1e-9;

/** Where two strands of a closed polyline cross: segment `i` at `t`, segment `j` at `u`. */
export type Crossing = { i: number; t: number; j: number; u: number; point: Point };

/**
 * At most this many crossings are collected by all the sweeps of one budget (`SweepBudget`). Real
 * pieces have a few; a star of 500 thin spikes at 100 mm allowance about 60 000.
 */
export const MAX_CROSSINGS = 200_000;
/**
 * At most this many pairs of segments whose x ranges overlap are compared by all the sweeps of one
 * budget (`findCrossings`, `polygonsCross`). Real pieces need a few thousand per sweep; a comb of
 * hundreds of teeth with overlapping offsets millions. About 0.2 s in Bun on a laptop.
 */
export const MAX_SWEEP_PAIRS = 20_000_000;

/** Thrown when a computation would exceed one of its work limits; the caller reports it. */
export class WorkLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkLimitError";
  }
}

/**
 * The work left for the crossing sweeps of one computation, used up in place. One budget is shared
 * by every sweep of a cutting line, so its total work is bounded, not that of each sweep.
 */
export type SweepBudget = { pairs: number; crossings: number };

/** A full budget: MAX_SWEEP_PAIRS pairs and MAX_CROSSINGS crossings. */
export function sweepBudget(): SweepBudget {
  return { pairs: MAX_SWEEP_PAIRS, crossings: MAX_CROSSINGS };
}

/**
 * Every place where two non-adjacent segments of the closed polyline `loop` cross (segment `i`
 * runs from `loop[i]` to `loop[i + 1]`, the last one back to the start). A point exactly on a
 * segment's line counts as lying on its left (a consistent symbolic perturbation), so a crossing
 * through a vertex is found once, a touch is not a crossing and collinear overlaps are ignored.
 * Sweep over the segments sorted by their smallest x. Throws WorkLimitError when `budget` runs out
 * of compared pairs or crossings.
 */
export function findCrossings(
  loop: readonly Point[],
  budget: SweepBudget = sweepBudget(),
): Crossing[] {
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
  const active = new Int32Array(n);
  let size = 0;
  for (const i of order) {
    // Drop the segments that end before this one starts, compacting the active list in place.
    let kept = 0;
    for (let k = 0; k < size; k++) {
      const j = active[k]!;
      if (maxX[j]! >= minX[i]!) active[kept++] = j;
    }
    size = kept;
    spendPairs(budget, size);
    for (let k = 0; k < size; k++) {
      const j = active[k]!;
      if (maxY[j]! < minY[i]! || maxY[i]! < minY[j]!) continue;
      if (j === (i + 1) % n || i === (j + 1) % n) continue;
      const crossing = properCrossing(loop, Math.min(i, j), Math.max(i, j));
      if (crossing === null) continue;
      budget.crossings--;
      if (budget.crossings < 0) throw new WorkLimitError("too many crossings");
      crossings.push(crossing);
    }
    active[size++] = i;
  }
  return crossings;
}

/**
 * Whether an edge of closed polygon `a` crosses an edge of closed polygon `b`, clear of rounding
 * (touching and overlapping do not count). Sweep over both polygons' segments sorted by smallest x;
 * throws WorkLimitError when `budget` runs out of compared pairs.
 */
export function polygonsCross(
  a: readonly Point[],
  b: readonly Point[],
  budget: SweepBudget = sweepBudget(),
): boolean {
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
  const active: Segment[] = [];
  for (const segment of segments) {
    let kept = 0;
    for (const other of active) if (other.maxX >= segment.minX) active[kept++] = other;
    active.length = kept;
    spendPairs(budget, kept);
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
 * the walk exceeds its step bound). Finding the crossings spends `budget` (`findCrossings`).
 */
export function outerBoundary(
  loop: readonly Point[],
  budget: SweepBudget = sweepBudget(),
): Point[] | null {
  const n = loop.length;
  if (n < 3) return null;
  const crossings = findCrossings(loop, budget);
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

function spendPairs(budget: SweepBudget, pairs: number): void {
  budget.pairs -= pairs;
  if (budget.pairs < 0) throw new WorkLimitError("too many segment pairs to compare");
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

/**
 * Whether segments p1-p2 and q1-q2 cross, each one's ends lying clearly (more than
 * MERGE_TOLERANCE) on either side of the other's line: touching, overlapping and crossings within
 * rounding of a shared line do not count.
 */
export function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
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
