// The cutting line of a pattern piece: its outline offset outwards by the seam allowance, edge by
// edge (ADR 0007). Pure geometry on a computed piece in mm user units; drawing it is the view's
// job (`cuttingLinePathData` in svg.ts).
//
// Steps: read and validate the allowances; flatten and offset every edge (offset.ts), with the
// dart peak across every detected dart (darts.ts); join consecutive edges at the outline's
// vertices (joins.ts: miter, clipped miter, round join, concave intersection or smooth step); keep
// the outer boundary of the resulting closed polyline, which removes loops and overlaps
// (boundary.ts); check it (with a conservative second construction when the first fails) and
// start it at its leftmost point. Never throws.
//
// Work is bounded by limits, each refusing the piece as `degenerate_geometry` when exceeded: at
// most MAX_OUTLINE_ENTRIES outline entries, MAX_CUTTING_LINE_SEGMENTS flattening segments for all
// edges together, MAX_RAW_LINE_POINTS points in the raw line (offset edges, corner joins and dart
// peaks together) and one SweepBudget (MAX_SWEEP_PAIRS compared segment pairs, MAX_CROSSINGS
// crossings) shared by every crossing sweep of the computation, the second construction included.
//
// Cost, measured with Bun in Docker on a laptop: about 0.07 to 0.1 ms per skirt piece and 0.2 to
// 0.25 ms per bodice piece (a few hundred segments; the crossing sweeps are near-linear there). A
// piece that needs the second construction costs about twice as much. The worst hostile outlines
// found at the entry limit (stars of hundreds of thin spikes, combs, serpentines of wavy rows, a
// thousand large cubics, all at 100 mm) take at most about 0.2 s and 100 MB, then give a line or
// are refused. A view should still compute it once per drawn input rather than on every pointer
// move.

import { type Dart, type DartPeak, dartPeak, findDarts } from "./darts";
import { insidePolygon } from "./label";
import {
  cleanLoop,
  findCrossings,
  leftmostIndex,
  outerBoundary,
  polygonsCross,
  type SweepBudget,
  sweepBudget,
  WorkLimitError,
} from "./boundary";
import { joinStrands } from "./joins";
import {
  cubicSegments,
  type Edge,
  edgeTangent,
  FLATTEN_TOLERANCE,
  flattenEdge,
  MAX_CUTTING_LINE_SEGMENTS,
  MERGE_TOLERANCE,
  offsetEdge,
  polygonArea,
} from "./offset";
import { MAX_OUTLINE_ENTRIES, MAX_SECTION_ENTRIES } from "./validate";
import {
  cross,
  distance,
  MAX_COORDINATE,
  type Point,
  pointSegmentDistance,
  sub,
} from "./vector";

type CuttingPoint = Readonly<Point>;

/** What the cutting line reads of a piece; a `ComputedPiece` is one. */
export type CuttingPiece = {
  readonly outline: readonly (
    | {
        readonly name: string;
        readonly type: "line";
        readonly from: CuttingPoint;
        readonly to: CuttingPoint;
      }
    | {
        readonly name: string;
        readonly type: "cubic";
        readonly from: CuttingPoint;
        readonly c1: CuttingPoint;
        readonly c2: CuttingPoint;
        readonly to: CuttingPoint;
      }
  )[];
};

/** Seam allowance in mm: `default` for every outline edge not in `edges` (keyed by curve name). */
export type SeamAllowances = {
  readonly default: number;
  readonly edges?: Readonly<Record<string, number>>;
};

/** Why there is no cutting line. `invalid_seam_allowance` without `edge` concerns the default or
 * the shape of the input. */
export type CuttingLineError =
  | { kind: "invalid_seam_allowance"; edge?: string; message: string }
  | { kind: "degenerate_geometry"; message: string };

/**
 * Where a cutting line is not the construction described on `cuttingLine`:
 * - `safe_construction`: that construction failed its checks, and the conservative one was used
 *   (every convex corner round, no extended edges, darts as ordinary edges);
 * - `dart_without_peak`: a detected dart whose legs (indices into the piece's `outline`) are cut
 *   as ordinary edges, with a notch instead of a dart peak.
 */
export type CuttingLineApproximation =
  | { kind: "safe_construction" }
  | { kind: "dart_without_peak"; legs: [number, number] };

/** `approximations` is there only when there are any. */
export type CuttingLineResult =
  | { ok: true; points: Point[]; approximations?: CuttingLineApproximation[] }
  | { ok: false; errors: CuttingLineError[] };

/** The largest seam allowance (mm) accepted for an edge. */
export const MAX_SEAM_ALLOWANCE = 100;
/** At most this many `invalid_seam_allowance` errors are returned; the rest are dropped. */
export const MAX_ALLOWANCE_ERRORS = 100;
/** Curve names longer than this are cut short in error messages (`edge` keeps the whole name). */
const MAX_NAME_IN_MESSAGE = 80;
/** Outlines whose signed area is smaller than this (mm^2) have no inside. */
const MIN_AREA = 1e-6;
/** Rounds of `outerBoundary` before a line that still crosses itself is given up. */
const BOUNDARY_ROUNDS = 3;

/**
 * The raw cutting line (offset edges, corner joins and dart peaks, before its crossings are
 * resolved) may have at most this many points. Real pieces have a few hundred; a comb of hundreds
 * of teeth with round joins at 100 mm about 40 000.
 */
export const MAX_RAW_LINE_POINTS = 50_000;

const SELF_CROSSING = "The outline crosses itself, so it has no cutting line";
const TOO_COMPLEX = "The piece is too complex for a cutting line";

/** An outline edge with its allowance and its index in the piece's `outline`. */
type ReadEdge = { edge: Edge; allowance: number; index: number };

/**
 * The cutting line of `piece`: a closed polygon (last point not repeated) in mm, SVG coordinates,
 * around the outline offset outwards by the seam allowance of each edge. It runs in the same
 * rotational direction as the outline, starts at its leftmost point (smallest `x`, then smallest
 * `y`), has no consecutive points closer than 1e-6 mm, does not cross itself, and every outline
 * vertex lies inside it or on it. Curves are flattened to within about 0.02 mm.
 *
 * - `allowances.default` applies to every edge not in `allowances.edges` (keyed by curve name);
 *   values are finite mm from 0 to MAX_SEAM_ALLOWANCE, `0` putting the line on the edge (a fold).
 *   Names that are not in the outline are ignored, so one map can serve every piece; they are
 *   validated all the same. A curve that appears more than once gets the same allowance each time.
 * - Convex corners are mitered, cut off at MITER_LIMIT times the larger allowance; concave corners
 *   are the intersection of the two offset edges; a smooth join of different allowances is a
 *   straight step. Where a miter would come closer to the outline than the smaller allowance (next
 *   to a curve that curls away sharply), the corner is round. Tight concave curves and allowances
 *   wider than a narrow part do not make the line loop or cross itself. Should that construction
 *   still fail its checks (outlines with sharply curling curves), a conservative one is tried: all
 *   convex corners round, no extended edges, darts as ordinary edges. The result then lists
 *   `safe_construction` in `approximations`.
 * - A detected dart (darts.ts) gets a dart peak, pressed toward the seam before it in outline
 *   order. Its legs are not on the cutting line; their allowances are validated but not used.
 *   Two darts with one seam between them get a peak each, the line running from one to the
 *   other, unless that seam is too short for the allowance. A detected dart without a peak (that,
 *   a failed construction or the conservative construction) is cut as ordinary edges with a notch
 *   and listed as `dart_without_peak` in `approximations`.
 *
 * Every invalid allowance value is its own `invalid_seam_allowance` error (at most
 * MAX_ALLOWANCE_ERRORS of them; a map of more than MAX_SECTION_ENTRIES edges is a single error),
 * and then there is no line. An empty, open, zero-area, non-finite or self-intersecting outline is
 * `degenerate_geometry`, and so is one that exceeds a work limit (module comment). Never throws.
 */
export function cuttingLine(piece: CuttingPiece, allowances: SeamAllowances): CuttingLineResult {
  try {
    return compute(piece, allowances);
  } catch (error) {
    if (error instanceof WorkLimitError) return degenerate(TOO_COMPLEX);
    return degenerate("The cutting line could not be computed for this piece");
  }
}

function compute(piece: unknown, input: unknown): CuttingLineResult {
  const allowances = readAllowances(input);
  if (!allowances.ok) return { ok: false, errors: allowances.errors };
  const outline = readOutline(piece, allowances.default, allowances.edges);
  if (typeof outline === "string") return degenerate(outline);

  const steps = segmentBudget(outline);
  const flat = outline.flatMap(({ edge }, i) => flattenEdge(edge, steps[i]!).slice(0, -1));
  const area = polygonArea(flat);
  if (!(Math.abs(area) >= MIN_AREA)) return degenerate("The outline encloses no area");
  // Checked up front: whether a crossing outline still gives a line that passes the checks below
  // depends on the allowance, and such a line is nonsense at any allowance.
  const budget = sweepBudget();
  if (findCrossings(flat, budget).length > 0) return degenerate(SELF_CROSSING);
  const sign = Math.sign(area);

  const exact = trace(outline, steps, sign, flat, "exact", budget);
  const traced = exact ?? trace(outline, steps, sign, flat, "safe", budget);
  if (traced === null) return degenerate("No cutting line could be constructed for this outline");
  const { line, unshaped } = traced;
  const approximations: CuttingLineApproximation[] = [
    ...(exact === null ? [{ kind: "safe_construction" } as const] : []),
    ...unshaped.map(({ legIndex }) => ({
      kind: "dart_without_peak" as const,
      legs: [outline[legIndex]!.index, outline[(legIndex + 1) % outline.length]!.index] as [
        number,
        number,
      ],
    })),
  ];
  const start = leftmostIndex(line);
  const points = [...line.slice(start), ...line.slice(0, start)];
  return approximations.length > 0 ? { ok: true, points, approximations } : { ok: true, points };
}

/**
 * How corners and darts are built. `"exact"` is the construction described on `cuttingLine`.
 * `"safe"` is the fallback for outlines where that fails its checks (curves that curl sharply
 * near a corner, where tangent-based miters and extensions cut across the piece): round joins at
 * convex corners, concave corners only where the offset edges really cross, darts as ordinary
 * edges.
 */
type Mode = "exact" | "safe";

// The checked cutting line in `mode` with the detected darts that got no peak, or null when it
// fails a check: it must not cross itself or the flattened outline, run in the outline's
// direction and have every outline vertex inside or on it. Throws WorkLimitError when the raw
// line gets longer than MAX_RAW_LINE_POINTS or the crossing sweeps exhaust `budget`.
function trace(
  outline: readonly ReadEdge[],
  steps: readonly number[],
  sign: number,
  flat: readonly Point[],
  mode: Mode,
  budget: SweepBudget,
): { line: Point[]; unshaped: Dart[] } | null {
  const built = buildUnits(outline, steps, sign, mode);
  if (built === null) return null;
  const { units, unshaped } = built;
  joinUnits(units, sign, mode);

  // One round removes every crossing it finds; more only matter for rounding at crossings that
  // lie on top of each other.
  let loop = cleanLoop(units.flatMap((unit) => unit.points));
  for (let round = 0; round < BOUNDARY_ROUNDS; round++) {
    const traced = outerBoundary(loop, budget);
    if (traced === null || traced.length < 3) return null;
    if (findCrossings(traced, budget).length === 0) {
      const valid =
        polygonArea(traced) * sign > 0 &&
        !polygonsCross(traced, flat, budget) &&
        enclosesOutline(traced, outline);
      return valid ? { line: traced, unshaped } : null;
    }
    loop = traced;
  }
  return null;
}

/** One stretch of the raw cutting line: an offset edge, or a dart from its S1 to its S2. */
type Unit = {
  points: Point[];
  /** The flattened outline edges at the start and the end of the unit. */
  readonly startOutline: readonly Point[];
  readonly endOutline: readonly Point[];
  readonly endVertex: Point;
  readonly startTangent: Point;
  readonly endTangent: Point;
  readonly startAllowance: number;
  readonly endAllowance: number;
};

// The offset edges and dart peaks in outline order, with the detected darts that got no peak (all
// of them in safe mode), or null when an edge has no tangent.
function buildUnits(
  outline: readonly ReadEdge[],
  steps: readonly number[],
  sign: number,
  mode: Mode,
): { units: Unit[]; unshaped: Dart[] } | null {
  const n = outline.length;
  const detected = findDarts(
    outline.map(({ edge }) => edge),
    sign,
  );
  const darts = mode === "exact" ? detected : [];
  const shaped = new Set<Dart>();
  const dartAt = new Map<number, Dart>(darts.map((dart) => [dart.s1Index, dart]));
  const inside = new Set(
    darts.flatMap((dart) => [dart.legIndex, (dart.legIndex + 1) % n, dart.s2Index]),
  );
  // Start where no dart is cut in two: at an edge outside every dart, or at a dart's S1.
  let first = 0;
  while (first < n && inside.has(first)) first++;

  const units: Unit[] = [];
  for (let k = 0; k < n;) {
    const i = (first + k) % n;
    const dart = dartAt.get(i);
    if (dart !== undefined) {
      const chain = dartUnit(dart, dartAt, outline, steps, sign);
      if (chain !== null) {
        units.push(chain.unit);
        for (const peaked of chain.darts) shaped.add(peaked);
        k += 1 + 3 * chain.darts.length;
        continue;
      }
    }
    const { edge, allowance } = outline[i]!;
    const startTangent = edgeTangent(edge, 0);
    const endTangent = edgeTangent(edge, 1);
    if (startTangent === null || endTangent === null) return null;
    const flat = flattenEdge(edge, steps[i]!);
    units.push({
      points: offsetEdge(edge, allowance, sign, steps[i]),
      startOutline: flat,
      endOutline: flat,
      endVertex: edge.to,
      startTangent,
      endTangent,
      startAllowance: allowance,
      endAllowance: allowance,
    });
    k++;
  }
  return { units, unshaped: detected.filter((dart) => !shaped.has(dart)) };
}

// The unit of `dart` and of the darts chained after it (each one's S1 is the previous one's S2),
// with those darts; null when `dart` itself gets no peak. A chained dart whose peak fails ends the
// chain; its edges become ordinary edges.
function dartUnit(
  dart: Dart,
  dartAt: ReadonlyMap<number, Dart>,
  outline: readonly ReadEdge[],
  steps: readonly number[],
  sign: number,
): { unit: Unit; darts: Dart[] } | null {
  const startTangent = edgeTangent(dart.s1, 0);
  if (startTangent === null) return null;
  const peakOf = (of: Dart, seam1?: Point[]): DartPeak | null => {
    if (edgeTangent(of.s2, 1) === null) return null;
    const segments = { s1: steps[of.s1Index]!, s2: steps[of.s2Index]! };
    const a1 = outline[of.s1Index]!.allowance;
    return dartPeak(of, a1, outline[of.s2Index]!.allowance, sign, segments, seam1);
  };
  let peak = peakOf(dart);
  if (peak === null) return null;
  const darts = [dart];
  for (;;) {
    const next = dartAt.get(darts[darts.length - 1]!.s2Index);
    if (next === undefined || next === dart) break;
    const seam = peak.points.slice(peak.tail);
    // The line after the first fold must start on the offset of the seam between the darts and
    // before the next fold. It does not when that seam is too short for the allowance: then the
    // first peak's own line runs through the outline there, or the folds cross within the
    // allowance, and pressing both darts the same way would cut into the allowance.
    const between = outline[next.s1Index]!;
    const start = seam[0]!;
    const onOffset =
      distanceToPolyline(start, flattenEdge(between.edge, steps[next.s1Index]!)) >=
      between.allowance - 2 * FLATTEN_TOLERANCE;
    if (!onOffset || !beforeFold(start, next)) break;
    const chained = peakOf(next, seam);
    if (chained === null) break;
    peak = {
      points: [...peak.points.slice(0, peak.tail), ...chained.points],
      tail: peak.tail + chained.tail,
    };
    darts.push(next);
  }
  const last = darts[darts.length - 1]!;
  return {
    unit: {
      points: peak.points,
      startOutline: flattenEdge(dart.s1, steps[dart.s1Index]!),
      endOutline: flattenEdge(last.s2, steps[last.s2Index]!),
      endVertex: last.s2.to,
      startTangent,
      endTangent: edgeTangent(last.s2, 1)!,
      startAllowance: outline[dart.s1Index]!.allowance,
      endAllowance: outline[last.s2Index]!.allowance,
    },
    darts,
  };
}

function distanceToPolyline(point: Point, polyline: readonly Point[]): number {
  let best = Infinity;
  for (let k = 0; k + 1 < polyline.length; k++) {
    best = Math.min(best, pointSegmentDistance(point, polyline[k]!, polyline[k + 1]!));
  }
  return best;
}

// Whether `point` lies clearly on the side of the fold A -> X of `dart` away from its other leg.
function beforeFold(point: Point, { apex, x, y }: Dart): boolean {
  const fold = sub(x, apex);
  const side = cross(fold, sub(point, apex));
  const other = cross(fold, sub(y, apex));
  return side * Math.sign(other) < -MERGE_TOLERANCE * Math.hypot(fold.x, fold.y);
}

// Joins each unit to the next at their shared outline vertex, trimming or extending them in place.
// Throws WorkLimitError as soon as the units hold more than MAX_RAW_LINE_POINTS points.
function joinUnits(units: Unit[], sign: number, mode: Mode): void {
  let total = 0;
  for (const unit of units) total += unit.points.length;
  for (let k = 0; k < units.length; k++) {
    if (total > MAX_RAW_LINE_POINTS) throw new WorkLimitError("the raw cutting line is too long");
    const current = units[k]!;
    const next = units[(k + 1) % units.length]!;
    const corner = {
      vertex: current.endVertex,
      t1: current.endTangent,
      a1: current.endAllowance,
      t2: next.startTangent,
      a2: next.startAllowance,
      sign,
    };
    const joined = joinStrands(current.points, next.points, corner, {
      guard: [current.endOutline, next.startOutline],
      safe: mode === "safe",
    });
    total += joined.a.length - current.points.length;
    current.points = joined.a;
    if (next !== current) {
      total += joined.b.length - next.points.length;
      next.points = joined.b;
    }
  }
  if (total > MAX_RAW_LINE_POINTS) throw new WorkLimitError("the raw cutting line is too long");
}

// Flattening step counts per edge (1 for a line), scaled down together when the piece would get
// more than MAX_CUTTING_LINE_SEGMENTS segments. Each cubic keeps its first segment and a share of
// the rest, so the total stays within the limit (readOutline allows far fewer edges than that).
function segmentBudget(outline: readonly ReadEdge[]): number[] {
  const steps = outline.map(({ edge, allowance }) => cubicSegments(edge, allowance));
  const total = steps.reduce((sum, count) => sum + count, 0);
  if (total <= MAX_CUTTING_LINE_SEGMENTS) return steps;
  const factor = (MAX_CUTTING_LINE_SEGMENTS - steps.length) / (total - steps.length);
  return steps.map((count) => 1 + Math.floor((count - 1) * factor));
}

// Whether every outline vertex lies inside the closed polygon or within MERGE_TOLERANCE of it.
function enclosesOutline(polygon: readonly Point[], outline: readonly ReadEdge[]): boolean {
  return outline.every(({ edge: { from } }) => {
    if (insidePolygon(polygon, from.x, from.y)) return true;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!;
      const b = polygon[(i + 1) % polygon.length]!;
      // A cheap box test first: this runs over the whole line for every vertex on it (a fold).
      if (
        from.x < Math.min(a.x, b.x) - MERGE_TOLERANCE ||
        from.x > Math.max(a.x, b.x) + MERGE_TOLERANCE ||
        from.y < Math.min(a.y, b.y) - MERGE_TOLERANCE ||
        from.y > Math.max(a.y, b.y) + MERGE_TOLERANCE
      ) {
        continue;
      }
      if (pointSegmentDistance(from, a, b) <= MERGE_TOLERANCE) return true;
    }
    return false;
  });
}

type ReadAllowances =
  | { ok: true; default: number; edges: Map<string, number> }
  | { ok: false; errors: CuttingLineError[] };

// The allowances, read without trusting their shape: own enumerable keys only, every read in a
// try block, values looked up through a Map (no prototype access).
function readAllowances(input: unknown): ReadAllowances {
  if (typeof input !== "object" || input === null) {
    return invalid("Seam allowances must be an object with a default in mm");
  }
  const errors: CuttingLineError[] = [];
  const fallback = readField(input, "default");
  if (!validAllowance(fallback.value)) {
    errors.push({
      kind: "invalid_seam_allowance",
      message: `The default seam allowance must be a number from 0 to ${MAX_SEAM_ALLOWANCE} mm`,
    });
  }

  const edges = new Map<string, number>();
  const record = readField(input, "edges");
  if (!record.ok) {
    errors.push({
      kind: "invalid_seam_allowance",
      message: "The seam allowances per edge could not be read",
    });
  } else if (record.value !== undefined) {
    const keys =
      typeof record.value === "object" && record.value !== null && !Array.isArray(record.value)
        ? ownKeys(record.value)
        : null;
    if (keys === null) {
      errors.push({
        kind: "invalid_seam_allowance",
        message: "The seam allowances per edge must be an object keyed by curve name",
      });
    } else if (keys.length > MAX_SECTION_ENTRIES) {
      errors.push({
        kind: "invalid_seam_allowance",
        message: `The seam allowances per edge must have at most ${MAX_SECTION_ENTRIES} entries`,
      });
    } else {
      for (const name of keys) {
        const entry = readField(record.value, name);
        if (validAllowance(entry.value)) {
          edges.set(name, entry.value);
        } else if (errors.length < MAX_ALLOWANCE_ERRORS) {
          errors.push({
            kind: "invalid_seam_allowance",
            edge: name,
            message:
              `The seam allowance of "${shortName(name)}" must be a number from 0 to ` +
              `${MAX_SEAM_ALLOWANCE} mm`,
          });
        }
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, default: fallback.value as number, edges };
}

// `name` cut to MAX_NAME_IN_MESSAGE characters for an error message.
function shortName(name: string): string {
  return name.length > MAX_NAME_IN_MESSAGE ? `${name.slice(0, MAX_NAME_IN_MESSAGE)}...` : name;
}

function readField(source: unknown, key: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: (source as Record<string, unknown>)[key] };
  } catch {
    return { ok: false, value: undefined };
  }
}

function ownKeys(source: object): string[] | null {
  try {
    return Object.keys(source);
  } catch {
    return null;
  }
}

function validAllowance(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SEAM_ALLOWANCE
  );
}

function invalid(message: string): ReadAllowances {
  return { ok: false, errors: [{ kind: "invalid_seam_allowance", message }] };
}

// The outline's edges with their allowances, or the reason it has no cutting line. Point-like
// edges (shorter than MERGE_TOLERANCE) are left out; an entry of an unknown type is a line
// between its ends.
function readOutline(
  piece: unknown,
  fallback: number,
  allowances: ReadonlyMap<string, number>,
): ReadEdge[] | string {
  let entries: unknown[];
  try {
    const outline: unknown =
      typeof piece === "object" && piece !== null ? (piece as { outline?: unknown }).outline : null;
    if (!Array.isArray(outline) || outline.length === 0) return "The piece has no outline";
    if (outline.length > MAX_OUTLINE_ENTRIES) {
      return `The outline has more than ${MAX_OUTLINE_ENTRIES} edges`;
    }
    entries = [...outline];
  } catch {
    return "The outline could not be read";
  }

  const edges: ReadEdge[] = [];
  let previous: Point | null = null;
  let first: Point | null = null;
  for (const [index, entry] of entries.entries()) {
    const edge = readEdge(entry);
    if (edge === null) return "An outline edge is not a finite line or cubic within the bounds";
    if (previous !== null && distance(previous, edge.from) > MERGE_TOLERANCE) {
      return "The outline does not close";
    }
    first ??= edge.from;
    previous = edge.to;
    if (pointLike(edge)) continue;
    const allowance =
      typeof edge.name === "string" ? (allowances.get(edge.name) ?? fallback) : fallback;
    edges.push({ edge, allowance, index });
  }
  if (first !== null && previous !== null && distance(previous, first) > MERGE_TOLERANCE) {
    return "The outline does not close";
  }
  if (edges.length === 0) return "The outline encloses no area";
  return edges;
}

function readEdge(entry: unknown): Edge | null {
  try {
    if (typeof entry !== "object" || entry === null) return null;
    const record = entry as Record<string, unknown>;
    const name = record.name as string;
    const from = readPoint(record.from);
    const to = readPoint(record.to);
    if (from === null || to === null) return null;
    if (record.type !== "cubic") return { name, type: "line", from, to };
    const c1 = readPoint(record.c1);
    const c2 = readPoint(record.c2);
    if (c1 === null || c2 === null) return null;
    return { name, type: "cubic", from, c1, c2, to };
  } catch {
    return null;
  }
}

function readPoint(value: unknown): Point | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return bounded(x) && bounded(y) ? { x, y } : null;
}

function bounded(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

function pointLike(edge: Edge): boolean {
  if (edge.type !== "cubic") return distance(edge.from, edge.to) < MERGE_TOLERANCE;
  return (
    distance(edge.from, edge.c1) + distance(edge.c1, edge.c2) + distance(edge.c2, edge.to) <
    MERGE_TOLERANCE
  );
}

function degenerate(message: string): CuttingLineResult {
  return { ok: false, errors: [{ kind: "degenerate_geometry", message }] };
}
