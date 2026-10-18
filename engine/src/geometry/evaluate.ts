// Evaluates a pattern definition against a measurement profile (ADR 0004): one namespace, one
// dependency graph of formulas, points, curves and pieces, errors as values and partial results.
// `compilePattern` does everything that depends only on the definition once; the evaluation it
// returns does only what depends on the input, so the editor can call it on every pointer move.

import { appendAll } from "../formula/arrays";
import {
  failedDependencyError,
  invalidValueError,
  type Span,
  unknownReferenceError,
} from "../formula/errors";
import { evaluateExpression } from "../formula/evaluate";
import { type Edge, type GraphPlan, planGraph, runGraphPlan } from "../formula/graph";
import { Namespace } from "../formula/namespace";
import { type Expr, type FormulaOptions, parseFormula } from "../formula/parser";
import { cubicLength } from "./bezier";
import { type GeometryState, geometryFunctions } from "./functions";
import { computePoint, curveFields, pointFields } from "./operations";
import { classifyReferences } from "./references";
import type {
  CompiledPattern,
  ComputedCurve,
  ComputedPiece,
  CurveDefinition,
  ElementError,
  ElementSource,
  EvaluateOptions,
  PatternDefinition,
  PatternInput,
  PatternResult,
  PieceDefinition,
  PointDefinition,
  ReferenceKind,
  UserOffset,
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

/** Everything about a valid definition that does not depend on the input. */
type Compiled = {
  definition: PatternDefinition;
  namespace: Namespace<ElementSource>;
  /** `invalid_name` / `duplicate_name`, in the order they were found. */
  nameErrors: readonly ElementError[];
  /** Parse, reference and outline errors, in the order they were found. */
  collectionErrors: readonly ElementError[];
  /** Names with a name or collection error; the values among them never resolve. */
  failed: ReadonlySet<string>;
  nodes: ReadonlyMap<string, Node>;
  graph: ReadonlyMap<string, readonly FieldEdge[]>;
  plan: GraphPlan;
  /** The computed geometry of the running evaluation, read by the geometry functions. */
  holder: GeometryState;
  formulaOptions: FormulaOptions;
};

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
 * Validates `definition` (untrusted) and prepares it for evaluation: checks names and every
 * reference, parses every formula once and orders the dependency graph, with its cycles. The
 * returned `evaluate(input, options?)` does only the work that depends on the input (measurement
 * values, parameter overrides and replacement user offsets), and returns exactly what
 * `evaluatePattern(definition, input)` does for the same definition and input. Never throws.
 *
 * Keep the compiled pattern while the definition stays the same (during a drag, while switching
 * measurement profiles) and compile again when it changes. Evaluations are independent: nothing of
 * one input is visible in the next. `definition` is not read again after this call.
 */
export function compilePattern(definition: unknown): CompiledPattern {
  const validated = validateDefinition(definition);
  if (!validated.ok) {
    const errors = validated.errors;
    return Object.freeze({
      evaluate: (): PatternResult => ({
        ok: false,
        ...emptyRecords(),
        errors: structuredClone(errors),
      }),
    });
  }
  const compiled = compileValid(validated.definition);
  return Object.freeze({
    evaluate: (input: PatternInput, options?: EvaluateOptions): PatternResult =>
      evaluateCompiled(compiled, readInput(input), readOffsets(options)),
  });
}

/**
 * Evaluates `definition` (untrusted, validated first with `validateDefinition`) against `input`
 * and returns the computed values, points (final and base positions), curves and pieces in
 * declaration order, together with every error. Never throws, for any input. The same as
 * `compilePattern(definition).evaluate(input)`; compile once instead when evaluating the same
 * definition repeatedly.
 *
 * - A structurally invalid definition gives its `invalid_definition` / `unsupported_version`
 *   errors and empty records.
 * - Declared measurements, parameters, formulas, points, curves and pieces share one namespace
 *   (`invalid_name`, `duplicate_name`). Only declared measurements are read from the profile
 *   (`missing_measurement`, `invalid_value`); parameter overrides replace the defaults
 *   (`unknown_parameter` for undeclared ones, reported after all others, `invalid_value`).
 * - Every reference must name a declared element (`unknown_reference`) of the right kind
 *   (`wrong_reference_kind`); the first such problem of an element is reported. A piece whose
 *   outline does not close by point name is `open_outline`, whatever the geometry.
 * - Formulas, points, curves and pieces are evaluated once each, in dependency order, through the
 *   dependency graph (ADR 0003): one `circular_dependency` per cycle group and `failed_dependency`
 *   for dependants, each with the `field` of the reference. Points add their `user_offset` after
 *   the operation, and that final position is what everything downstream sees.
 * - Errors are sorted by the declaration order of the element they belong to.
 *
 * Pure: neither `definition` nor `input` is mutated or read again after the start. Linear in the
 * size of the definition, with no recursion that grows with it.
 */
export function evaluatePattern(definition: unknown, input: PatternInput): PatternResult {
  return compilePattern(definition).evaluate(input);
}

function compileValid(definition: PatternDefinition): Compiled {
  // 1. Names: declaration position (first occurrence) and every source of each name.
  const namespace = new Namespace<ElementSource>();
  for (const name of definition.measurements) namespace.declare(name, "measurement");
  for (const name of Object.keys(definition.parameters)) namespace.declare(name, "parameter");
  for (const name of Object.keys(definition.formulas)) namespace.declare(name, "formula");
  for (const point of definition.points) namespace.declare(point.name, "point");
  for (const curve of definition.curves) namespace.declare(curve.name, "curve");
  for (const piece of definition.pieces) namespace.declare(piece.name, "piece");
  const nameErrors: ElementError[] = namespace.nameErrors();
  const failed = new Set(nameErrors.map((error) => error.name));
  const collectionErrors: ElementError[] = [];

  // 2. Parse every formula and collect each element's edges, checking every reference. The
  // function table reads the geometry of the evaluation that is running from `holder`, so parsed
  // formulas stay valid across evaluations.
  const holder: GeometryState = { points: new Map(), curves: new Map() };
  const functions = geometryFunctions(holder);
  const formulaOptions: FormulaOptions = { functions };

  const checkReference = (
    owner: string,
    reference: string,
    span: Span,
    expected: ReferenceKind,
    field: string | undefined,
  ): ElementError | null => {
    const list = namespace.sourcesOf(reference);
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
      const parsed = parseFormula(source, formulaOptions);
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
  const fail = (error: ElementError): void => {
    collectionErrors.push(error);
    failed.add(error.name);
  };
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
    const formulas: [string, Expr][] = [];
    for (const [field, kind, value] of pointFields(point)) {
      if (kind === "name") {
        collector.name(field, value, "point");
        continue;
      }
      const expr = collector.formula(field, value);
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

  // 3. Order the graph once. Its cycle errors only depend on which nodes failed, and no node can
  // fail through the input: input errors belong to measurements and parameters, which are not
  // nodes (a node sharing their name failed as a duplicate above).
  const plan = planGraph(graph, { position: (name) => namespace.position(name), failed });

  return {
    definition,
    namespace,
    nameErrors,
    collectionErrors,
    failed,
    nodes,
    graph,
    plan,
    holder,
    formulaOptions,
  };
}

type Profile = { measurements: Map<string, unknown>; parameters: Map<string, unknown> };

function evaluateCompiled(
  compiled: Compiled,
  input: Profile,
  offsets: ReadonlyMap<string, UserOffset | null>,
): PatternResult {
  const { definition, namespace, nodes, graph, holder, formulaOptions } = compiled;
  const valueErrors: ElementError[] = [];
  const overrideErrors: ElementError[] = [];
  // Names that failed when compiling or through a value; only values without an error resolve (a
  // measurement or parameter can only fail when compiling through its name). Handed to the graph
  // as is, which copies it.
  const failed = new Set(compiled.failed);
  const failValue = (error: ElementError): void => {
    valueErrors.push(error);
    failed.add(error.name);
  };

  // 1. Values. Every value is checked, also for a name that already failed, so an independent bad
  // value is not hidden.
  const resolved = new Map<string, number>();
  const checked = new Set<string>();
  for (const name of definition.measurements) {
    if (checked.has(name)) continue;
    checked.add(name);
    if (!input.measurements.has(name)) {
      failValue(missingMeasurementError(name));
      continue;
    }
    const value = input.measurements.get(name);
    if (!isFiniteNumber(value)) failValue(invalidValueError(name, "measurement"));
    else if (!failed.has(name)) resolved.set(name, value);
  }
  for (const [name, fallback] of Object.entries(definition.parameters)) {
    const value = input.parameters.has(name) ? input.parameters.get(name) : fallback;
    if (!isFiniteNumber(value)) failValue(invalidValueError(name, "parameter"));
    else if (!failed.has(name)) resolved.set(name, value);
  }
  for (const name of input.parameters.keys()) {
    // Not `failValue`: the name may belong to another element (a measurement, say), which must not
    // fail because of a stray override.
    if (!Object.hasOwn(definition.parameters, name)) {
      overrideErrors.push(unknownParameterError(name));
    }
  }

  // 2. Evaluate every node once, in the planned dependency order. References were kind-checked
  // when compiling, so the lookups below only see names of the right kind that already computed.
  const points = new Map<string, Point>();
  const basePoints = new Map<string, Point>();
  const curves = new Map<string, ComputedCurve>();
  const pieces = new Map<string, ComputedPiece>();
  const lookup = (name: string): number | undefined => resolved.get(name);
  const pointOf = (name: string): Point => points.get(name) ?? NAN_POINT;

  const evaluatePoint = (
    name: string,
    node: Extract<Node, { type: "point" }>,
  ): ElementError | null => {
    const numbers = new Map<string, number>();
    for (const [field, expr] of node.formulas) {
      const result = evaluateExpression(expr, lookup, formulaOptions);
      if (!result.ok) return { ...result.error, name, field };
      numbers.set(field, result.value);
    }
    const result = computePoint(node.definition, numbers, pointOf);
    if (!result.ok) return { ...result.error, name };
    const base = result.point;
    // Checked before the offset, so every point in `points` also has its base position.
    if (!withinBounds(base)) return outOfBoundsError(name, "before the user offset ");
    basePoints.set(name, base);
    const offset = offsets.has(name) ? offsets.get(name) : node.definition.user_offset;
    const point =
      offset === undefined || offset === null
        ? base
        : { x: base.x + offset.dx, y: base.y + offset.dy };
    if (!withinBounds(point)) return outOfBoundsError(name, "");
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

  // Evaluation is synchronous and never calls back into a compiled pattern, so the holder belongs
  // to this run until it is cleared again below.
  holder.points = points;
  holder.curves = curves;
  let graphErrors: ElementError[];
  try {
    graphErrors = runGraphPlan<ElementError>(compiled.plan, {
      failed,
      evaluate: (name) => {
        const node = nodes.get(name);
        switch (node?.type) {
          case undefined:
            return null;
          case "formula": {
            const result = evaluateExpression(node.expr, lookup, formulaOptions);
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
  } finally {
    holder.points = EMPTY_POINTS;
    holder.curves = EMPTY_CURVES;
  }

  // 3. Errors in the order they would be found by a single pass (name, value, collection, graph
  // errors), then sorted by declaration order. Graph errors get the field of the edge the graph
  // chose: the first edge of the element to the dependency it names (`cycle[1]` for the head of a
  // cycle).
  const errors: ElementError[] = [...compiled.nameErrors];
  appendAll(errors, valueErrors);
  appendAll(errors, compiled.collectionErrors);
  for (const error of graphErrors) {
    if (error.kind !== "circular_dependency" && error.kind !== "failed_dependency") {
      errors.push(error);
      continue;
    }
    const target = error.kind === "circular_dependency" ? error.cycle[1] : error.dependency;
    const field = graph.get(error.name)?.find((edge) => edge.name === target)?.field;
    errors.push(field === undefined ? error : { ...error, field });
  }
  namespace.sortByPosition(errors);
  appendAll(errors, overrideErrors);
  // The compiled errors, and the spans of the others (from parsed formulas and graph edges), are
  // objects of the compiled pattern. One deep copy here keeps every result's errors its own.
  const ownErrors = structuredClone(errors);

  // 4. Records in declaration order, built in one pass over the names. `fromEntries` defines own
  // data properties, so names such as `__proto__` are stored safely.
  const entries = {
    values: [] as [string, number][],
    points: [] as [string, Point][],
    basePoints: [] as [string, Point][],
    curves: [] as [string, ComputedCurve][],
    pieces: [] as [string, ComputedPiece][],
  };
  for (const name of namespace.names()) {
    const value = resolved.get(name);
    if (value !== undefined) entries.values.push([name, value]);
    const point = points.get(name);
    if (point !== undefined) entries.points.push([name, point]);
    const base = basePoints.get(name);
    if (base !== undefined) entries.basePoints.push([name, base]);
    const curve = curves.get(name);
    if (curve !== undefined) entries.curves.push([name, curve]);
    const piece = pieces.get(name);
    if (piece !== undefined) entries.pieces.push([name, piece]);
  }
  const computed = {
    values: Object.fromEntries(entries.values),
    points: Object.fromEntries(entries.points),
    basePoints: Object.fromEntries(entries.basePoints),
    curves: Object.fromEntries(entries.curves),
    pieces: Object.fromEntries(entries.pieces),
  };
  return ownErrors.length === 0
    ? { ok: true, ...computed }
    : { ok: false, ...computed, errors: ownErrors };
}

const EMPTY_POINTS: ReadonlyMap<string, Point> = new Map();
const EMPTY_CURVES: ReadonlyMap<string, ComputedCurve> = new Map();

function emptyRecords() {
  return { values: {}, points: {}, basePoints: {}, curves: {}, pieces: {} };
}

/** Both coordinates within `MAX_COORDINATE` of 0 (`NaN` fails the comparison, so it is out). */
function withinBounds(point: Point): boolean {
  return Math.abs(point.x) <= MAX_COORDINATE && Math.abs(point.y) <= MAX_COORDINATE;
}

/**
 * The profile's measurements and parameter overrides as `Map`s of own enumerable entries. A
 * missing, `null` or non-object `input` or sub-record counts as empty, and so does one that throws
 * while being read (a hostile getter or proxy).
 */
function readInput(input: unknown): Profile {
  return {
    measurements: readRecord(input, "measurements"),
    parameters: readRecord(input, "parameters"),
  };
}

/**
 * The replacement user offsets of `options`, by point name. An entry that is `null` or `undefined`
 * means no offset; any other entry that is not `{ dx, dy }` with numbers gives `NaN`, so the point
 * fails as `degenerate_geometry` instead of silently using another offset. Unreadable `offsets`
 * count as none.
 */
function readOffsets(options: unknown): Map<string, UserOffset | null> {
  const offsets = new Map<string, UserOffset | null>();
  try {
    for (const [name, value] of readRecord(options, "offsets")) {
      if (value === null || value === undefined) {
        offsets.set(name, null);
        continue;
      }
      const record = typeof value === "object" ? (value as Record<string, unknown>) : {};
      const dx = typeof record.dx === "number" ? record.dx : Number.NaN;
      const dy = typeof record.dy === "number" ? record.dy : Number.NaN;
      offsets.set(name, { dx, dy });
    }
  } catch {
    offsets.clear();
  }
  return offsets;
}

/** Own enumerable entries of `source[key]`; empty when either is not an object or throws. */
function readRecord(source: unknown, key: string): Map<string, unknown> {
  try {
    if (typeof source !== "object" || source === null) return new Map();
    const record: unknown = (source as Record<string, unknown>)[key];
    if (typeof record !== "object" || record === null) return new Map();
    return new Map(Object.entries(record));
  } catch {
    return new Map();
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `{ field }` when there is one, so elements without fields (named formulas) carry none. */
function located(field: string | undefined): { field?: string } {
  return field === undefined ? {} : { field };
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

/** `degenerate_geometry` for a position out of bounds; `where` is "" or "before the user offset ". */
function outOfBoundsError(name: string, where: string): ElementError {
  return degenerateError(
    name,
    `The computed position ${where}is not a finite number within ${MAX_COORDINATE} mm of the origin`,
  );
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
