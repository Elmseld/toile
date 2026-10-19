// Edits of a stored pattern definition, for the browser editor (docs/adr/0008-pattern-editor.md).
//
// Everything here works on the raw definition JSON as stored, never on `validateDefinition`'s
// normalised copy, so a saved definition differs from the stored one only where the user edited
// it (the server checks exactly that). Edits return a new definition that shares every untouched
// object with the old one, and return the same object when nothing changes, so the editor's
// history can tell a no-op by identity.

import { compilePattern } from "../geometry/evaluate";
import { type FieldKind, OP_FIELDS } from "../geometry/operations";
import type {
  CompiledPattern,
  PatternError,
  PatternInput,
  PatternResult,
  UserOffset,
} from "../geometry/types";
import type { Point } from "../geometry/vector";

/** A pattern definition as stored (decoded JSON), not validated. */
export type RawDefinition = { readonly [key: string]: unknown };

/** A point object of a raw definition. */
export type RawPoint = {
  readonly name: string;
  readonly op?: unknown;
  readonly [key: string]: unknown;
};

/** A field of a point's operation and what it holds, for the editor's point panel. */
export type EditorField = { field: string; kind: FieldKind };

/** The outcome of `tryPattern`: a definition that evaluates without errors, or its errors. */
export type TryResult =
  | { ok: true; compiled: CompiledPattern; result: PatternResult & { ok: true } }
  | { ok: false; errors: PatternError[] };

/** `offset` rounded to 0.1 mm on both axes (and without a negative zero). */
export function roundOffset(offset: UserOffset): UserOffset {
  return { dx: roundToStep(offset.dx), dy: roundToStep(offset.dy) };
}

function roundToStep(value: number): number {
  // `+ 0` turns -0 into 0.
  return Math.round(value * 10) / 10 + 0;
}

/** The point objects of `definition`, or an empty list when it has none. */
function pointsOf(definition: RawDefinition): readonly unknown[] {
  const points = definition.points;
  return Array.isArray(points) ? points : [];
}

function isRawPoint(value: unknown): value is RawPoint {
  return (
    typeof value === "object" && value !== null && typeof (value as RawPoint).name === "string"
  );
}

function indexOfPoint(definition: RawDefinition, name: string): number {
  return pointsOf(definition).findIndex((point) => isRawPoint(point) && point.name === name);
}

/** The point called `name` in `definition`, as stored. */
export function getPoint(definition: RawDefinition, name: string): RawPoint | undefined {
  const point = pointsOf(definition)[indexOfPoint(definition, name)];
  return isRawPoint(point) ? point : undefined;
}

/** `definition` with the point at `index` replaced; every other object is shared. */
function replacePoint(definition: RawDefinition, index: number, point: RawPoint): RawDefinition {
  const points = [...pointsOf(definition)];
  points[index] = point;
  return { ...definition, points };
}

/**
 * A new definition in which the point `name` has `offset` (rounded to 0.1 mm) as its
 * `user_offset`, or none when `offset` is `null`. Only that point object is replaced; everything
 * else is shared and nothing is mutated. Returns `definition` itself when there is no such point
 * or the offset stays the same.
 */
export function setUserOffset(
  definition: RawDefinition,
  name: string,
  offset: UserOffset | null,
): RawDefinition {
  const index = indexOfPoint(definition, name);
  const point = getPoint(definition, name);
  if (point === undefined) return definition;

  if (offset === null) {
    if (!Object.hasOwn(point, "user_offset")) return definition;
    const { user_offset: _removed, ...rest } = point;
    return replacePoint(definition, index, rest as RawPoint);
  }

  const rounded = roundOffset(offset);
  const current = point.user_offset as Partial<UserOffset> | undefined;
  if (current?.dx === rounded.dx && current?.dy === rounded.dy) return definition;
  return replacePoint(definition, index, { ...point, user_offset: rounded });
}

/**
 * A new definition in which the formula field `field` of the point `name` is `formula`. Returns
 * `definition` itself when there is no such point, when `field` is not a formula field of the
 * point's op (a name, line or `which` field, or no field of it at all) or when the formula stays
 * the same.
 */
export function setPointFormula(
  definition: RawDefinition,
  name: string,
  field: string,
  formula: string,
): RawDefinition {
  const point = getPoint(definition, name);
  if (point === undefined || point[field] === formula) return definition;
  const isFormula = pointFields(point).some(
    (spec) => spec.field === field && spec.kind === "formula",
  );
  if (!isFormula) return definition;
  return replacePoint(definition, indexOfPoint(definition, name), { ...point, [field]: formula });
}

/** The fields of `point`'s operation in the engine's order, or none for an unknown op. */
export function pointFields(point: RawPoint): EditorField[] {
  const specs = typeof point.op === "string" ? OP_FIELDS.get(point.op) : undefined;
  return (specs ?? []).map(([field, kind]) => ({ field, kind }));
}

/** The names of the control points (`c1`, `c2`) of the cubic curves of `definition`. */
export function controlPoints(definition: RawDefinition): Set<string> {
  const names = new Set<string>();
  const curves = Array.isArray(definition.curves) ? definition.curves : [];
  for (const curve of curves as unknown[]) {
    if (typeof curve !== "object" || curve === null) continue;
    const { type, c1, c2 } = curve as { type?: unknown; c1?: unknown; c2?: unknown };
    if (type !== "cubic") continue;
    if (typeof c1 === "string") names.add(c1);
    if (typeof c2 === "string") names.add(c2);
  }
  return names;
}

/**
 * Compiles `definition` and evaluates it against `input`. `ok` only when the evaluation has no
 * errors: the editor keeps (and saves) only definitions and parameters that draw. Never throws.
 */
export function tryPattern(definition: RawDefinition, input: PatternInput): TryResult {
  const compiled = compilePattern(definition);
  const result = compiled.evaluate(input);
  return result.ok ? { ok: true, compiled, result } : { ok: false, errors: result.errors };
}

/**
 * The errors that belong to the point `name`, and with `field` only those of that field (a line
 * field also matches its elements, `line1` matches `line1/0`).
 */
export function errorsFor(
  errors: readonly PatternError[],
  name: string,
  field?: string,
): PatternError[] {
  return errors.filter((error) => {
    if (!("name" in error) || error.name !== name) return false;
    if (field === undefined) return true;
    const located = "field" in error ? error.field : undefined;
    return located === field || (located?.startsWith(`${field}/`) ?? false);
  });
}

/**
 * The name of the point of `points` nearest to `at`, if it lies within `radius` (user units, mm),
 * else `null`. Of equally near points, `prefer` wins (the selected point, so a point lying on
 * another stays selectable), then the first in `points`.
 */
export function pickPoint(
  points: Readonly<Record<string, Readonly<Point>>>,
  at: Readonly<Point>,
  radius: number,
  prefer?: string,
): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [name, point] of Object.entries(points)) {
    const d = Math.hypot(point.x - at.x, point.y - at.y);
    if (d > radius) continue;
    if (d < bestDistance || (d === bestDistance && name === prefer)) {
      best = name;
      bestDistance = d;
    }
  }
  return best;
}
