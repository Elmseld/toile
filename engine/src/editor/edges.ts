// Seam allowance edges for the browser editor
// (docs/adr/0011-markings-and-seam-allowance-storage.md): picking an outline edge under the pointer, and pure edits of a project's stored allowances.
//
// A project's allowances are `{ default, edges: { part: { curve: mm } } }`. Edits return a new
// object that shares every untouched map with the old one, and the same object when nothing
// changes, so the editor's history can tell a no-op by identity (as edits.ts does).

import { cubicAt } from "../geometry/bezier";
import { CUBIC_STEPS } from "../geometry/label";
import { DEFAULT_SEAM_ALLOWANCE, MAX_SEAM_ALLOWANCE } from "../geometry/seam-allowance";
import type { ComputedPiece } from "../geometry/types";
import { type Point, pointSegmentDistance } from "../geometry/vector";

/** A project's seam allowances in mm: the default and the user's values by part and curve name. */
export type ProjectSeamAllowances = {
  readonly default: number;
  readonly edges: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

/** Where an edge's allowance comes from: the user's value, the fold rule or the project default. */
export type EdgeAllowance = { value: number; source: "edge" | "fold" | "default" };

/**
 * The outline edge of `pieces` nearest to `at`, if it lies within `radius` (user units, mm), as
 * the piece's key and the curve's name, else `null`. A cubic is measured against CUBIC_STEPS
 * straight segments. Of equally near edges, the curve named `prefer` wins (the selected edge),
 * then the first in piece and outline order.
 */
export function pickEdge(
  pieces: Readonly<Record<string, Pick<ComputedPiece, "outline">>>,
  at: Readonly<Point>,
  radius: number,
  prefer?: string,
): { piece: string; curve: string } | null {
  let best: { piece: string; curve: string } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [piece, computed] of Object.entries(pieces)) {
    for (const curve of computed.outline) {
      const d = curveDistance(curve, at);
      if (!(d <= radius)) continue;
      if (d < bestDistance || (d === bestDistance && curve.name === prefer)) {
        best = { piece, curve: curve.name };
        bestDistance = d;
      }
    }
  }
  return best;
}

function curveDistance(curve: ComputedPiece["outline"][number], at: Point): number {
  if (curve.type !== "cubic") return pointSegmentDistance(at, curve.from, curve.to);
  let nearest = Number.POSITIVE_INFINITY;
  let previous: Point = curve.from;
  for (let i = 1; i <= CUBIC_STEPS; i++) {
    const next = cubicAt(curve.from, curve.c1, curve.c2, curve.to, i / CUBIC_STEPS);
    nearest = Math.min(nearest, pointSegmentDistance(at, previous, next));
    previous = next;
  }
  return nearest;
}

/**
 * The project's allowances from decoded JSON (the page's `data-seam-allowances`), read
 * tolerantly: a missing or invalid default becomes DEFAULT_SEAM_ALLOWANCE, and entries that are
 * not a map of a part, or not a finite number from 0 to MAX_SEAM_ALLOWANCE, are dropped, as are
 * parts left without entries. Only own keys are read, and the maps are built with
 * `Object.fromEntries`, so names such as `__proto__` stay plain data. Never throws.
 */
export function readSeamAllowances(raw: unknown): ProjectSeamAllowances {
  try {
    const fallback = isRecord(raw) && Object.hasOwn(raw, "default") ? raw.default : undefined;
    const edges = isRecord(raw) && Object.hasOwn(raw, "edges") ? raw.edges : undefined;
    return {
      default: validAllowance(fallback) ? fallback : DEFAULT_SEAM_ALLOWANCE,
      edges: isRecord(edges) ? readParts(edges) : {},
    };
  } catch {
    return { default: DEFAULT_SEAM_ALLOWANCE, edges: {} };
  }
}

function readParts(
  edges: Readonly<Record<string, unknown>>,
): Record<string, Record<string, number>> {
  const parts: [string, Record<string, number>][] = [];
  for (const [part, curves] of Object.entries(edges)) {
    if (!isRecord(curves)) continue;
    const valid = Object.entries(curves).filter((entry): entry is [string, number] =>
      validAllowance(entry[1]),
    );
    if (valid.length > 0) parts.push([part, Object.fromEntries(valid)]);
  }
  return Object.fromEntries(parts);
}

/** `allowances` with the project default `value` (mm; the caller checks the range). */
export function setDefaultAllowance(
  allowances: ProjectSeamAllowances,
  value: number,
): ProjectSeamAllowances {
  return allowances.default === value ? allowances : { ...allowances, default: value };
}

/**
 * `allowances` with `value` (mm; the caller checks the range) for the edge `curve` of `part`, or
 * without the user's value for it when `value` is `null`. A part left without values is removed.
 */
export function setEdgeAllowance(
  allowances: ProjectSeamAllowances,
  part: string,
  curve: string,
  value: number | null,
): ProjectSeamAllowances {
  const curves = own(allowances.edges, part) ?? {};
  const current = own(curves, curve);
  if (current === value || (value === null && current === undefined)) return allowances;

  const nextCurves =
    value === null
      ? Object.fromEntries(Object.entries(curves).filter(([name]) => name !== curve))
      : { ...curves, [curve]: value };
  const parts: [string, Readonly<Record<string, number>>][] = Object.entries(allowances.edges);
  if (!Object.hasOwn(allowances.edges, part)) parts.push([part, nextCurves]);
  const kept = parts
    .map(([name, map]): [string, Readonly<Record<string, number>>] =>
      name === part ? [name, nextCurves] : [name, map],
    )
    .filter(([, map]) => Object.keys(map).length > 0);
  return { ...allowances, edges: Object.fromEntries(kept) };
}

/**
 * The allowance the cutting line uses for edge `curve` of `piece` in `part`, and where it comes
 * from (the panel's value and hint): the user's value, else 0 on a fold edge, else the default.
 */
export function edgeAllowance(
  allowances: ProjectSeamAllowances,
  part: string,
  piece: Pick<ComputedPiece, "folds">,
  curve: string,
): EdgeAllowance {
  const value = own(own(allowances.edges, part) ?? {}, curve);
  if (value !== undefined) return { value, source: "edge" };
  if (piece.folds.includes(curve)) return { value: 0, source: "fold" };
  return { value: allowances.default, source: "default" };
}

/** An own property of `record`, never one inherited from its prototype. */
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validAllowance(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SEAM_ALLOWANCE
  );
}
