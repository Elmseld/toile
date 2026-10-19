// The cutting line of a pattern piece: its outline offset outwards by the seam allowance, edge by
// edge (ADR 0007). Pure geometry on a computed piece in mm user units; drawing it is the view's
// job (`cuttingLinePathData` in svg.ts).
//
// Steps: read and validate the allowances; flatten and offset every edge (offset.ts), with the
// dart peak across every detected dart (darts.ts); join consecutive edges at the outline's
// vertices (miter, clipped miter, round join, concave intersection or smooth step); keep the
// outer boundary of the resulting closed polyline, which removes loops and overlaps; check it
// (with a conservative second construction when the first fails) and start it at its leftmost
// point. Never throws; work is bounded by MAX_CUTTING_LINE_SEGMENTS.
//
// Cost, measured with Bun in Docker on a laptop: about 0.07 to 0.1 ms per skirt piece and 0.2 to
// 0.25 ms per bodice piece (a few hundred segments; the crossing sweep is near-linear there). A
// hostile outline of 1000 large cubics at the segment budget takes about 0.3 s. A view should
// still compute it once per drawn input rather than on every pointer move.

import { dartCuttingLine, type Dart, findDarts } from "./darts";
import { insidePolygon } from "./label";
import {
  cleanLoop,
  cubicSegments,
  type Edge,
  edgeTangent,
  findCrossings,
  flattenEdge,
  polygonsCross,
  joinStrands,
  leftmostIndex,
  MAX_CUTTING_LINE_SEGMENTS,
  MERGE_TOLERANCE,
  offsetEdge,
  outerBoundary,
  polygonArea,
} from "./offset";
import { distance, MAX_COORDINATE, type Point } from "./vector";

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

export type CuttingLineResult =
  { ok: true; points: Point[] } | { ok: false; errors: CuttingLineError[] };

/** The largest seam allowance (mm) accepted for an edge. */
export const MAX_SEAM_ALLOWANCE = 100;
/** Outlines whose signed area is smaller than this (mm^2) have no inside. */
const MIN_AREA = 1e-6;
/** Rounds of `outerBoundary` before a line that still crosses itself is given up. */
const BOUNDARY_ROUNDS = 3;

type ReadEdge = { edge: Edge; allowance: number };

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
 *   convex corners round, no extended edges, darts as ordinary edges.
 * - A detected dart (darts.ts) gets a dart peak, pressed toward the seam before it in outline
 *   order. Its legs are not on the cutting line; their allowances are validated but not used.
 *
 * Every invalid allowance value is its own `invalid_seam_allowance` error, and then there is no
 * line. An empty, open, zero-area, non-finite or self-intersecting outline is
 * `degenerate_geometry`. Never throws.
 */
export function cuttingLine(piece: CuttingPiece, allowances: SeamAllowances): CuttingLineResult {
  try {
    return compute(piece, allowances);
  } catch {
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
  const sign = Math.sign(area);

  const line =
    trace(outline, steps, sign, flat, "exact") ?? trace(outline, steps, sign, flat, "safe");
  if (line === null) return degenerate("The outline crosses itself, so it has no cutting line");
  const start = leftmostIndex(line);
  return { ok: true, points: [...line.slice(start), ...line.slice(0, start)] };
}

/**
 * How corners and darts are built. `"exact"` is the construction described on `cuttingLine`.
 * `"safe"` is the fallback for outlines where that fails its checks (curves that curl sharply
 * near a corner, where tangent-based miters and extensions cut across the piece): round joins at
 * convex corners, concave corners only where the offset edges really cross, darts as ordinary
 * edges.
 */
type Mode = "exact" | "safe";

// The checked cutting line in `mode`, or null when it fails a check: it must not cross itself or
// the flattened outline, run in the outline's direction and have every outline vertex inside or
// on it.
function trace(
  outline: readonly ReadEdge[],
  steps: readonly number[],
  sign: number,
  flat: readonly Point[],
  mode: Mode,
): Point[] | null {
  const units = buildUnits(outline, steps, sign, mode);
  if (units === null) return null;
  joinUnits(units, sign, mode);

  // One round removes every crossing it finds; more only matter for rounding at crossings that
  // lie on top of each other.
  let loop = cleanLoop(units.flatMap((unit) => unit.points));
  for (let round = 0; round < BOUNDARY_ROUNDS; round++) {
    const traced = outerBoundary(loop);
    if (traced === null || traced.length < 3) return null;
    if (findCrossings(traced).length === 0) {
      const valid =
        polygonArea(traced) * sign > 0 &&
        !polygonsCross(traced, flat) &&
        enclosesOutline(traced, outline);
      return valid ? traced : null;
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

// The offset edges and dart peaks in outline order, or null when an edge has no tangent.
function buildUnits(
  outline: readonly ReadEdge[],
  steps: readonly number[],
  sign: number,
  mode: Mode,
): Unit[] | null {
  const n = outline.length;
  const darts =
    mode === "exact"
      ? findDarts(
          outline.map(({ edge }) => edge),
          sign,
        )
      : [];
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
      const unit = dartUnit(dart, outline, steps, sign);
      if (unit !== null) {
        units.push(unit);
        k += 4;
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
  return units;
}

function dartUnit(
  dart: Dart,
  outline: readonly ReadEdge[],
  steps: readonly number[],
  sign: number,
): Unit | null {
  const a1 = outline[dart.s1Index]!.allowance;
  const a2 = outline[dart.s2Index]!.allowance;
  const startTangent = edgeTangent(dart.s1, 0);
  const endTangent = edgeTangent(dart.s2, 1);
  if (startTangent === null || endTangent === null) return null;
  const segments = { s1: steps[dart.s1Index]!, s2: steps[dart.s2Index]! };
  const points = dartCuttingLine(dart, a1, a2, sign, "before", segments);
  if (points === null) return null;
  return {
    points,
    startOutline: flattenEdge(dart.s1, segments.s1),
    endOutline: flattenEdge(dart.s2, segments.s2),
    endVertex: dart.s2.to,
    startTangent,
    endTangent,
    startAllowance: a1,
    endAllowance: a2,
  };
}

// Joins each unit to the next at their shared outline vertex, trimming or extending them in place.
function joinUnits(units: Unit[], sign: number, mode: Mode): void {
  for (let k = 0; k < units.length; k++) {
    const current = units[k]!;
    const next = units[(k + 1) % units.length]!;
    const joined = joinStrands(
      current.points,
      next.points,
      current.endVertex,
      current.endTangent,
      current.endAllowance,
      next.startTangent,
      next.startAllowance,
      sign,
      [current.endOutline, next.startOutline],
      mode === "safe",
    );
    current.points = joined.a;
    if (next !== current) next.points = joined.b;
  }
}

// Flattening step counts per edge (1 for a line), scaled down together when the piece would get
// more than MAX_CUTTING_LINE_SEGMENTS segments.
function segmentBudget(outline: readonly ReadEdge[]): number[] {
  const steps = outline.map(({ edge, allowance }) => cubicSegments(edge, allowance));
  const total = steps.reduce((sum, count) => sum + count, 0);
  if (total <= MAX_CUTTING_LINE_SEGMENTS) return steps;
  const lines = outline.filter(({ edge }) => edge.type !== "cubic").length;
  const factor = (MAX_CUTTING_LINE_SEGMENTS - lines) / (total - lines);
  return steps.map((count, i) =>
    outline[i]!.edge.type === "cubic" ? Math.max(1, Math.floor(count * factor)) : count,
  );
}

// Whether every outline vertex lies inside the closed polygon or within MERGE_TOLERANCE of it.
function enclosesOutline(polygon: readonly Point[], outline: readonly ReadEdge[]): boolean {
  return outline.every(({ edge: { from } }) => {
    if (insidePolygon(polygon, from.x, from.y)) return true;
    for (let i = 0; i < polygon.length; i++) {
      if (
        segmentDistance(from, polygon[i]!, polygon[(i + 1) % polygon.length]!) <= MERGE_TOLERANCE
      ) {
        return true;
      }
    }
    return false;
  });
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
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
    }
    for (const name of keys ?? []) {
      const entry = readField(record.value, name);
      if (validAllowance(entry.value)) {
        edges.set(name, entry.value);
      } else {
        errors.push({
          kind: "invalid_seam_allowance",
          edge: name,
          message:
            `The seam allowance of "${name}" must be a number from 0 to ` +
            `${MAX_SEAM_ALLOWANCE} mm`,
        });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, default: fallback.value as number, edges };
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
    if (outline.length > MAX_CUTTING_LINE_SEGMENTS) return "The outline has too many edges";
    entries = [...outline];
  } catch {
    return "The outline could not be read";
  }

  const edges: ReadEdge[] = [];
  let previous: Point | null = null;
  let first: Point | null = null;
  for (const entry of entries) {
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
    edges.push({ edge, allowance });
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
