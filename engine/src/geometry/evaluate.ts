// Evaluates a pattern definition against a measurement profile (ADR 0004): one namespace, one
// dependency graph of formulas, points, curves and pieces, errors as values and partial results.

import { appendAll } from "../formula/arrays";
import {
  failedDependencyError,
  invalidValueError,
  type Span,
  unknownReferenceError,
} from "../formula/errors";
import { evaluateExpression } from "../formula/evaluate";
import { type Edge, evaluateGraph } from "../formula/graph";
import { isIdentifier } from "../formula/lexer";
import { type Expr, parseFormula } from "../formula/parser";
import { cubicLength } from "./bezier";
import { geometryFunctions } from "./functions";
import { computePoint, curveFields, pointFields } from "./operations";
import { classifyReferences } from "./references";
import type {
  ComputedCurve,
  ComputedPiece,
  CurveDefinition,
  ElementError,
  ElementSource,
  PatternDefinition,
  PatternInput,
  PatternResult,
  PieceDefinition,
  PointDefinition,
  ReferenceKind,
} from "./types";
import { validateDefinition } from "./validate";
import { distance, MAX_COORDINATE, type Point } from "./vector";

/** A dependency edge with the field of the element it comes from (absent for named formulas). */
type FieldEdge = Edge & { field?: string };

type Node =
  | { type: "formula"; expr: Expr }
  | { type: "point"; definition: PointDefinition; formulas: [field: string, expr: Expr][] }
  | { type: "curve"; definition: CurveDefinition }
  | { type: "piece"; definition: PieceDefinition };

const KIND_OF_SOURCE: Readonly<Record<ElementSource, ReferenceKind>> = {
  measurement: "value",
  parameter: "value",
  formula: "value",
  point: "point",
  curve: "curve",
  piece: "piece",
};

const NAN_POINT: Point = Object.freeze({ x: Number.NaN, y: Number.NaN });

/**
 * Evaluates `definition` (untrusted, validated first with `validateDefinition`) against `input`
 * and returns the computed values, points, curves and pieces in declaration order, together with
 * every error. Never throws, for any input.
 *
 * - A structurally invalid definition gives its `invalid_definition` / `unsupported_version`
 *   errors and empty records.
 * - Declared measurements, parameters, formulas, points, curves and pieces share one namespace
 *   (`invalid_name`, `duplicate_name`). Only declared measurements are read from the profile
 *   (`missing_measurement`, `invalid_value`); parameter overrides replace the defaults
 *   (`unknown_parameter` for undeclared ones, reported after all others, `invalid_value`).
 * - Every reference must name a declared element (`unknown_reference`) of the right kind
 *   (`wrong_reference_kind`); the first such problem of an element is reported.
 * - Formulas, points, curves and pieces are evaluated once each, in dependency order, through
 *   `evaluateGraph` (ADR 0003): one `circular_dependency` per cycle group and `failed_dependency`
 *   for dependants, each with the `field` of the reference. Points add their `user_offset` after
 *   the operation, and that final position is what everything downstream sees.
 * - Errors are sorted by the declaration order of the element they belong to.
 *
 * Pure: neither `definition` nor `input` is mutated or read again after the start. Linear in the
 * size of the definition, with no recursion that grows with it.
 */
export function evaluatePattern(definition: unknown, input: PatternInput): PatternResult {
  const validated = validateDefinition(definition);
  if (!validated.ok) {
    return { ok: false, values: {}, points: {}, curves: {}, pieces: {}, errors: validated.errors };
  }
  return evaluateValid(validated.definition, readInput(input));
}

type Profile = { measurements: Map<string, unknown>; parameters: Map<string, unknown> };

function evaluateValid(definition: PatternDefinition, input: Profile): PatternResult {
  const errors: ElementError[] = [];
  const overrideErrors: ElementError[] = [];
  const failed = new Set<string>();
  const fail = (error: ElementError): void => {
    errors.push(error);
    failed.add(error.name);
  };

  // 1. Names: declaration index (first occurrence) and every source of each name.
  const index = new Map<string, number>();
  const sources = new Map<string, ElementSource[]>();
  const declare = (name: string, source: ElementSource): void => {
    if (!index.has(name)) index.set(name, index.size);
    const list = sources.get(name);
    if (list === undefined) sources.set(name, [source]);
    else list.push(source);
  };
  for (const name of definition.measurements) declare(name, "measurement");
  for (const name of Object.keys(definition.parameters)) declare(name, "parameter");
  for (const name of Object.keys(definition.formulas)) declare(name, "formula");
  for (const point of definition.points) declare(point.name, "point");
  for (const curve of definition.curves) declare(curve.name, "curve");
  for (const piece of definition.pieces) declare(piece.name, "piece");

  for (const [name, list] of sources) {
    if (!isIdentifier(name)) {
      for (const source of list) fail(invalidNameError(name, source));
    } else if (list.length > 1) {
      fail(duplicateNameError(name, list));
    }
  }

  // 2. Values. Every value is checked, also for a name that already failed, so an independent bad
  // value is not hidden; only names without an error resolve.
  const resolved = new Map<string, number>();
  const checked = new Set<string>();
  for (const name of definition.measurements) {
    if (checked.has(name)) continue;
    checked.add(name);
    if (!input.measurements.has(name)) {
      fail(missingMeasurementError(name));
      continue;
    }
    const value = input.measurements.get(name);
    if (!isFiniteNumber(value)) fail(invalidValueError(name, "measurement"));
    else if (!failed.has(name)) resolved.set(name, value);
  }
  for (const [name, fallback] of Object.entries(definition.parameters)) {
    const value = input.parameters.has(name) ? input.parameters.get(name) : fallback;
    if (!isFiniteNumber(value)) fail(invalidValueError(name, "parameter"));
    else if (!failed.has(name)) resolved.set(name, value);
  }
  for (const name of input.parameters.keys()) {
    // Not `fail`: the name may belong to another element (a measurement, say), which must not
    // fail because of a stray override.
    if (!Object.hasOwn(definition.parameters, name)) {
      overrideErrors.push(unknownParameterError(name));
    }
  }

  // 3. Parse every formula and collect each element's edges, checking every reference.
  const points = new Map<string, Point>();
  const curves = new Map<string, ComputedCurve>();
  const pieces = new Map<string, ComputedPiece>();
  const functions = geometryFunctions({ points, curves });

  const checkReference = (
    owner: string,
    reference: string,
    span: Span,
    expected: ReferenceKind,
    field: string | undefined,
  ): ElementError | null => {
    const list = sources.get(reference);
    if (list === undefined) {
      return { ...unknownReferenceError(reference, span), name: owner, ...located(field) };
    }
    // A name declared twice already failed; its dependants get `failed_dependency` instead.
    const [only] = list;
    if (list.length > 1 || only === undefined) return null;
    const actual = KIND_OF_SOURCE[only];
    if (actual === expected) return null;
    return wrongReferenceKindError(owner, field, reference, expected, actual, span);
  };

  /** Edges of one element; the first problem found makes it fail and stops collecting. */
  class EdgeCollector {
    readonly edges: FieldEdge[] = [];
    error: ElementError | null = null;

    constructor(private readonly owner: string) {}

    name(field: string, reference: string, expected: "point" | "curve"): void {
      this.add(field, reference, { start: 0, end: reference.length }, expected);
    }

    formula(field: string | undefined, source: string): Expr | null {
      if (this.error !== null) return null;
      const parsed = parseFormula(source, { functions });
      if (!parsed.ok) {
        this.error = { ...parsed.error, name: this.owner, ...located(field) };
        return null;
      }
      for (const ref of classifyReferences(parsed.expr, functions)) {
        this.add(field, ref.name, ref.span, ref.kind);
      }
      return parsed.expr;
    }

    private add(
      field: string | undefined,
      reference: string,
      span: Span,
      kind: ReferenceKind,
    ): void {
      if (this.error !== null) return;
      this.error = checkReference(this.owner, reference, span, kind, field);
      this.edges.push({ name: reference, span, ...located(field) });
    }
  }

  const nodes = new Map<string, Node>();
  const graph = new Map<string, FieldEdge[]>();
  const addNode = (name: string, collector: EdgeCollector, node: Node): void => {
    if (collector.error !== null) return fail(collector.error);
    nodes.set(name, node);
    graph.set(name, collector.edges);
  };
  const curveDefinitions = new Map<string, CurveDefinition>();

  for (const [name, source] of Object.entries(definition.formulas)) {
    if (failed.has(name)) continue;
    const collector = new EdgeCollector(name);
    const expr = collector.formula(undefined, source);
    if (expr !== null) addNode(name, collector, { type: "formula", expr });
    else if (collector.error !== null) fail(collector.error);
  }
  for (const point of definition.points) {
    if (failed.has(point.name)) continue;
    const collector = new EdgeCollector(point.name);
    const fields = pointFields(point);
    for (const [field, reference] of fields.names) collector.name(field, reference, "point");
    const formulas: [string, Expr][] = [];
    for (const [field, source] of fields.formulas) {
      const expr = collector.formula(field, source);
      if (expr !== null) formulas.push([field, expr]);
    }
    addNode(point.name, collector, { type: "point", definition: point, formulas });
  }
  for (const curve of definition.curves) {
    if (failed.has(curve.name)) continue;
    curveDefinitions.set(curve.name, curve);
    const collector = new EdgeCollector(curve.name);
    for (const [field, reference] of curveFields(curve)) collector.name(field, reference, "point");
    addNode(curve.name, collector, { type: "curve", definition: curve });
  }
  for (const piece of definition.pieces) {
    if (failed.has(piece.name)) continue;
    const collector = new EdgeCollector(piece.name);
    piece.outline.forEach((entry, i) => collector.name(`outline/${i}/curve`, entry.curve, "curve"));
    collector.name("grainline/from", piece.grainline.from, "point");
    collector.name("grainline/to", piece.grainline.to, "point");
    // Closure is structural, so it is checked here, before (and whatever the outcome of)
    // evaluating the curves: an open outline is reported for every measurement profile.
    collector.error ??= outlineClosureError(piece, curveDefinitions);
    addNode(piece.name, collector, { type: "piece", definition: piece });
  }

  // 4. Evaluate every node once, in dependency order. References were kind-checked above, so the
  // lookups below only see names of the right kind that already computed.
  const lookup = (name: string): number | undefined => resolved.get(name);
  const pointOf = (name: string): Point => points.get(name) ?? NAN_POINT;

  const evaluatePoint = (
    name: string,
    node: Extract<Node, { type: "point" }>,
  ): ElementError | null => {
    const numbers = new Map<string, number>();
    for (const [field, expr] of node.formulas) {
      const result = evaluateExpression(expr, lookup, { functions });
      if (!result.ok) return { ...result.error, name, field };
      numbers.set(field, result.value);
    }
    const result = computePoint(node.definition, numbers, pointOf);
    if (!result.ok) return { ...result.error, name };
    const offset = node.definition.user_offset;
    const point =
      offset === undefined
        ? result.point
        : { x: result.point.x + offset.dx, y: result.point.y + offset.dy };
    // `!(<=)` also catches NaN.
    if (!(Math.abs(point.x) <= MAX_COORDINATE && Math.abs(point.y) <= MAX_COORDINATE)) {
      return degenerateError(
        name,
        `The computed position is not a finite number within ${MAX_COORDINATE} mm of the origin`,
      );
    }
    points.set(name, point);
    return null;
  };

  const evaluateCurve = (name: string, curve: CurveDefinition): ElementError | null => {
    const from = pointOf(curve.from);
    const to = pointOf(curve.to);
    let computed: ComputedCurve;
    if (curve.type === "line") {
      computed = { name, type: "line", from, to, length: distance(from, to) };
    } else {
      const c1 = pointOf(curve.c1);
      const c2 = pointOf(curve.c2);
      computed = { name, type: "cubic", from, c1, c2, to, length: cubicLength(from, c1, c2, to) };
    }
    if (!Number.isFinite(computed.length)) {
      return degenerateError(name, "The length of the curve is not a finite number");
    }
    curves.set(name, computed);
    return null;
  };

  const evaluatePiece = (name: string, piece: PieceDefinition): ElementError | null => {
    const outlineCurves: ComputedCurve[] = [];
    for (const [i, { curve }] of piece.outline.entries()) {
      const computed = curves.get(curve);
      // Unreachable: the graph only evaluates a piece once all its curves computed.
      if (computed === undefined) {
        const span = { start: 0, end: curve.length };
        return { ...failedDependencyError(name, curve, span), field: `outline/${i}/curve` };
      }
      outlineCurves.push(computed);
    }
    pieces.set(name, {
      name,
      outline: outlineCurves,
      grainline: { from: pointOf(piece.grainline.from), to: pointOf(piece.grainline.to) },
    });
    return null;
  };

  const graphErrors = evaluateGraph<ElementError>(graph, {
    position: (name) => index.get(name) ?? Infinity,
    failed,
    evaluate: (name) => {
      const node = nodes.get(name);
      switch (node?.type) {
        case undefined:
          return null;
        case "formula": {
          const result = evaluateExpression(node.expr, lookup, { functions });
          if (!result.ok) return { ...result.error, name };
          resolved.set(name, result.value);
          return null;
        }
        case "point":
          return evaluatePoint(name, node);
        case "curve":
          return evaluateCurve(name, node.definition);
        case "piece":
          return evaluatePiece(name, node.definition);
      }
    },
  });

  // 5. Graph errors get the field of the edge `evaluateGraph` chose: the first edge of the element
  // to the dependency it names (`cycle[1]` for the head of a cycle).
  for (const error of graphErrors) {
    if (error.kind !== "circular_dependency" && error.kind !== "failed_dependency") {
      errors.push(error);
      continue;
    }
    const target = error.kind === "circular_dependency" ? error.cycle[1] : error.dependency;
    const field = graph.get(error.name)?.find((edge) => edge.name === target)?.field;
    errors.push(field === undefined ? error : { ...error, field });
  }

  const position = (error: ElementError): number => index.get(error.name) ?? Infinity;
  errors.sort((a, b) => position(a) - position(b));
  appendAll(errors, overrideErrors);

  // 6. Records in declaration order. `fromEntries` defines own data properties, so names such as
  // `__proto__` are stored safely.
  const inOrder = <T>(map: ReadonlyMap<string, T>): Record<string, T> =>
    Object.fromEntries(
      [...index.keys()].flatMap((name) => {
        const value = map.get(name);
        return value === undefined ? [] : [[name, value] as const];
      }),
    );
  const computed = {
    values: inOrder(resolved),
    points: inOrder(points),
    curves: inOrder(curves),
    pieces: inOrder(pieces),
  };
  return errors.length === 0 ? { ok: true, ...computed } : { ok: false, ...computed, errors };
}

/**
 * The profile's measurements and parameter overrides as `Map`s of own enumerable entries. A
 * missing, `null` or non-object `input` or sub-record counts as empty, and so does one that throws
 * while being read (a hostile getter or proxy).
 */
function readInput(input: unknown): Profile {
  const read = (key: "measurements" | "parameters"): Map<string, unknown> => {
    try {
      if (typeof input !== "object" || input === null) return new Map();
      const record: unknown = (input as Record<string, unknown>)[key];
      if (typeof record !== "object" || record === null) return new Map();
      return new Map(Object.entries(record));
    } catch {
      return new Map();
    }
  };
  return { measurements: read("measurements"), parameters: read("parameters") };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `{ field }` when there is one, so elements without fields (named formulas) carry none. */
function located(field: string | undefined): { field?: string } {
  return field === undefined ? {} : { field };
}

function invalidNameError(name: string, source: ElementSource): ElementError {
  return {
    kind: "invalid_name",
    name,
    source,
    message: `"${name}" is not a valid name (use letters, digits and _, not starting with a digit)`,
  };
}

function duplicateNameError(name: string, sources: ElementSource[]): ElementError {
  return {
    kind: "duplicate_name",
    name,
    sources,
    message: `"${name}" is declared more than once (${sources.join(", ")})`,
  };
}

function missingMeasurementError(name: string): ElementError {
  return {
    kind: "missing_measurement",
    name,
    message: `The measurement "${name}" is missing from the profile`,
  };
}

function unknownParameterError(name: string): ElementError {
  return {
    kind: "unknown_parameter",
    name,
    message: `"${name}" is not a parameter of this pattern`,
  };
}

function wrongReferenceKindError(
  name: string,
  field: string | undefined,
  reference: string,
  expected: ReferenceKind,
  actual: ReferenceKind,
  span: Span,
): ElementError {
  return {
    kind: "wrong_reference_kind",
    name,
    ...located(field),
    reference,
    expected,
    actual,
    span,
    message: `"${reference}" is a ${actual}, but a ${expected} is expected here`,
  };
}

function degenerateError(name: string, message: string): ElementError {
  return { kind: "degenerate_geometry", name, message };
}

/**
 * `open_outline` on the first entry whose curve does not start where the previous one ends
 * (cyclically, so the wrap-around from the last entry to the first is checked too), or `null`.
 * Pairs with a curve whose definition is unknown (a duplicate name) are skipped: the piece then
 * fails through that dependency.
 */
function outlineClosureError(
  piece: PieceDefinition,
  curves: ReadonlyMap<string, CurveDefinition>,
): ElementError | null {
  const { outline } = piece;
  for (let i = 0; i < outline.length; i++) {
    const next = (i + 1) % outline.length;
    const current = curves.get(outline[i]?.curve ?? "");
    const following = curves.get(outline[next]?.curve ?? "");
    if (current !== undefined && following !== undefined && current.to !== following.from) {
      return openOutlineError(piece.name, `outline/${next}/curve`, current, following);
    }
  }
  return null;
}

function openOutlineError(
  name: string,
  field: string,
  current: CurveDefinition,
  following: CurveDefinition,
): ElementError {
  return {
    kind: "open_outline",
    name,
    field,
    message: `The outline does not close: "${current.name}" ends at "${current.to}", but "${following.name}" starts at "${following.from}"`,
  };
}
