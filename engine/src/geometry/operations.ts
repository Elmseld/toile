// Field layouts of points and curves (shared by the validator and the evaluator) and the point
// operations themselves.

import type { CurveDefinition, PointDefinition, PointOp } from "./types";
import {
  add,
  direction,
  distance,
  EPSILON,
  intersectLineCircle,
  intersectLines,
  perpendicularOffset,
  type Point,
  scale,
  sub,
} from "./vector";

/**
 * What a field holds: a point name, a formula string, a line (exactly two point names) or the
 * `which` choice of `line_circle_intersection`.
 */
export type FieldKind = "name" | "formula" | "line" | "which";

/** A field of a point operation: its key and what it holds. */
export type FieldSpec = readonly [field: string, kind: FieldKind];

/**
 * The fields of every point operation, in edge order (which decides the field a
 * `failed_dependency` names). A `Map`, so an `op` such as `__proto__` from untrusted input never
 * reaches a prototype member.
 */
export const OP_FIELDS: ReadonlyMap<string, readonly FieldSpec[]> = new Map<
  PointOp,
  readonly FieldSpec[]
>([
  ["start", [["x", "formula"], ["y", "formula"]]],
  ["offset", [["from", "name"], ["dx", "formula"], ["dy", "formula"]]],
  ["along_line", [["from", "name"], ["to", "name"], ["distance", "formula"]]],
  ["along_angle", [["from", "name"], ["angle", "formula"], ["distance", "formula"]]],
  ["perpendicular", [["from", "name"], ["to", "name"], ["distance", "formula"]]],
  ["line_intersection", [["line1", "line"], ["line2", "line"]]],
  [
    "line_circle_intersection",
    [["line", "line"], ["center", "name"], ["radius", "formula"], ["which", "which"]],
  ],
  ["midpoint", [["from", "name"], ["to", "name"]]],
]);

/** The point-name fields of every curve type, in edge order. */
export const CURVE_FIELDS: ReadonlyMap<string, readonly string[]> = new Map<
  CurveDefinition["type"],
  readonly string[]
>([
  ["line", ["from", "to"]],
  ["cubic", ["from", "c1", "c2", "to"]],
]);

/** The point names of `curve` with their fields, in edge order (from `CURVE_FIELDS`). */
export function curveFields(curve: CurveDefinition): [field: string, point: string][] {
  // A validated definition has exactly the fields of its type; read them by key.
  const fields = curve as unknown as Readonly<Record<string, unknown>>;
  return (CURVE_FIELDS.get(curve.type) ?? []).map((field) => [field, String(fields[field])]);
}

/** A point-name or formula field of a point, as `pointFields` lists it. */
export type PointField = readonly [field: string, kind: "name" | "formula", value: string];

/**
 * The point-name and formula fields of `point` in edge order (from `OP_FIELDS`), which is the
 * order its dependency edges must be collected in. Line elements are addressed as `line1/0`,
 * `line1/1`; `which` is not listed.
 */
export function pointFields(point: PointDefinition): PointField[] {
  const result: PointField[] = [];
  // A validated definition has exactly the fields of its op; read them by key.
  const fields = point as unknown as Readonly<Record<string, unknown>>;
  for (const [field, kind] of OP_FIELDS.get(point.op) ?? []) {
    const value = fields[field];
    if ((kind === "name" || kind === "formula") && typeof value === "string") {
      result.push([field, kind, value]);
    } else if (kind === "line" && Array.isArray(value)) {
      result.push(
        [`${field}/0`, "name", String(value[0])],
        [`${field}/1`, "name", String(value[1])],
      );
    }
  }
  return result;
}

/** Why an operation has no result. The caller adds the point's `name`. */
export type OperationError =
  | { kind: "degenerate_geometry"; field?: string; message: string }
  | { kind: "no_intersection"; message: string };

export type OperationResult = { ok: true; point: Point } | { ok: false; error: OperationError };

/**
 * Computes `point` (without its user offset) from its evaluated formula fields (`numbers`, keyed
 * by field) and the final positions of the points it names (`pointOf`). Pure; never throws.
 */
export function computePoint(
  point: PointDefinition,
  numbers: ReadonlyMap<string, number>,
  pointOf: (name: string) => Point,
): OperationResult {
  const number = (field: string): number => numbers.get(field) ?? Number.NaN;

  switch (point.op) {
    case "start":
      return ok({ x: number("x"), y: number("y") });

    case "offset":
      return ok(add(pointOf(point.from), { x: number("dx"), y: number("dy") }));

    case "along_line": {
      const from = pointOf(point.from);
      const to = pointOf(point.to);
      const length = distance(from, to);
      if (!(length >= EPSILON)) return coincident("to", point.from, point.to);
      return ok(add(from, scale(sub(to, from), number("distance") / length)));
    }

    case "along_angle":
      return ok(add(pointOf(point.from), scale(direction(number("angle")), number("distance"))));

    case "perpendicular": {
      const from = pointOf(point.from);
      const result = perpendicularOffset(from, pointOf(point.to), number("distance"));
      return result === null ? coincident("to", point.from, point.to) : ok(result);
    }

    case "line_intersection": {
      const [a1, a2] = point.line1.map(pointOf) as [Point, Point];
      const [b1, b2] = point.line2.map(pointOf) as [Point, Point];
      if (!(distance(a1, a2) >= EPSILON)) return coincident("line1", ...point.line1);
      if (!(distance(b1, b2) >= EPSILON)) return coincident("line2", ...point.line2);
      const result = intersectLines(a1, a2, b1, b2);
      return result === null
        ? noIntersection("The two lines are parallel and do not intersect")
        : ok(result);
    }

    case "line_circle_intersection": {
      const radius = number("radius");
      if (radius < 0) {
        return degenerate("radius", `The radius must not be negative (got ${radius})`);
      }
      const [a, b] = point.line.map(pointOf) as [Point, Point];
      if (!(distance(a, b) >= EPSILON)) return coincident("line", ...point.line);
      const hits = intersectLineCircle(a, b, pointOf(point.center), radius);
      if (hits === null) return noIntersection("The line does not meet the circle");
      return ok(point.which === "first" ? hits[0] : hits[1]);
    }

    case "midpoint": {
      const from = pointOf(point.from);
      const to = pointOf(point.to);
      return ok({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    }
  }
}

function ok(point: Point): OperationResult {
  return { ok: true, point };
}

function degenerate(field: string, message: string): OperationResult {
  return { ok: false, error: { kind: "degenerate_geometry", field, message } };
}

function coincident(field: string, a: string, b: string): OperationResult {
  return degenerate(field, `"${a}" and "${b}" are at the same position, so they give no direction`);
}

function noIntersection(message: string): OperationResult {
  return { ok: false, error: { kind: "no_intersection", message } };
}
