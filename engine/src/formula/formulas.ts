// Evaluates a set of measurements, parameters and named formulas in dependency order (ADR 0003).

import { appendAll } from "./arrays";
import {
  type FormulaError,
  type InputSource,
  invalidValueError,
  syntaxError,
  unknownReferenceError,
} from "./errors";
import { evaluateExpression } from "./evaluate";
import { type Edge, evaluateGraph } from "./graph";
import { Namespace } from "./namespace";
import { type Expr, parseFormula, references } from "./parser";

export type FormulaInput = {
  measurements: Readonly<Record<string, number>>;
  parameters: Readonly<Record<string, number>>;
  formulas: Readonly<Record<string, string>>;
};

/**
 * `values` holds every valid measurement and parameter and every formula that evaluated, also
 * when other formulas failed, so callers can still use what works.
 */
export type EvaluationResult =
  | { ok: true; values: Record<string, number> }
  | { ok: false; values: Record<string, number>; errors: FormulaError[] };

type ParsedFormula = { expr: Expr; refs: Edge[] };

/**
 * Evaluates every formula in `input` once, in dependency order, whatever the declaration order.
 *
 * Measurements, parameters and formulas share one namespace. Problems are returned as errors,
 * never thrown: invalid or duplicate names, non-finite measurement or parameter values, parse
 * errors, unknown references, circular dependencies, formulas that depend on a failed name, and
 * evaluation errors. Each group of mutually dependent formulas gets one `circular_dependency`
 * error (its shortest cycle through the first-declared member that has no error yet) and
 * `failed_dependency` for every other member without one. Every measurement and parameter value is
 * checked, so an invalid or duplicate name with a non-finite value also gets `invalid_value`.
 * Errors are sorted by the declaration order of the name they belong to (measurements, then
 * parameters, then formulas); errors of one name keep the order in which they were found (name
 * errors, then `invalid_value` per source in measurement-then-parameter order, then the rest).
 *
 * Pure: `input` is not mutated. A missing or `null` `measurements`, `parameters` or `formulas`
 * (from an untyped caller) counts as empty. Runs in time linear in the total formula length; each
 * formula is parsed and evaluated at most once.
 */
export function evaluateFormulas(input: FormulaInput): EvaluationResult {
  const errors: FormulaError[] = [];
  const failed = new Set<string>();

  const measurements = entries(input?.measurements);
  const parameters = entries(input?.parameters);
  const formulas = entries(input?.formulas);

  // Declaration position of each name (first occurrence) and every source it is declared in.
  const namespace = new Namespace<InputSource>();
  const declare = (entries: [string, unknown][], source: InputSource): void => {
    for (const [name] of entries) namespace.declare(name, source);
  };
  declare(measurements, "measurement");
  declare(parameters, "parameter");
  declare(formulas, "formula");

  const fail = (error: FormulaError): void => {
    errors.push(error);
    failed.add(error.name);
  };

  // 1. Names and values.
  for (const error of namespace.nameErrors()) fail(error);

  // Every value is checked, also for a name that already failed (invalid or duplicate), so an
  // independent bad value is not hidden; only names without an error resolve.
  const resolved = new Map<string, number>();
  const checkValues = (entries: [string, unknown][], source: "measurement" | "parameter"): void => {
    for (const [name, value] of entries) {
      const valid = typeof value === "number" && Number.isFinite(value);
      if (!valid) fail(invalidValueError(name, source));
      else if (!failed.has(name)) resolved.set(name, value);
    }
  };
  checkValues(measurements, "measurement");
  checkValues(parameters, "parameter");

  // 2. Parse. 3. Every referenced name must be declared somewhere (even if it failed).
  const parsed = new Map<string, ParsedFormula>();
  for (const [name, source] of formulas) {
    if (failed.has(name)) continue;
    if (typeof source !== "string") {
      fail({ ...syntaxError("Formula must be a string", { start: 0, end: 0 }), name });
      continue;
    }
    const result = parseFormula(source);
    if (!result.ok) {
      fail({ ...result.error, name });
      continue;
    }

    const refs = references(result.expr);
    for (const ref of refs) {
      if (namespace.sourcesOf(ref.name) === undefined) fail({ ...unknownReferenceError(ref.name, ref.span), name });
    }
    parsed.set(name, { expr: result.expr, refs });
  }

  // 4. Cycles, dependency order and evaluation of each formula once (see `evaluateGraph`).
  const lookup = (name: string): number | undefined => resolved.get(name);
  const graph = new Map([...parsed].map(([name, formula]) => [name, formula.refs] as const));
  const graphErrors = evaluateGraph(graph, {
    position: (name) => namespace.position(name),
    failed,
    evaluate: (name) => {
      const formula = parsed.get(name);
      if (formula === undefined) return null;
      const result = evaluateExpression(formula.expr, lookup);
      if (!result.ok) return { ...result.error, name };
      resolved.set(name, result.value);
      return null;
    },
  });
  appendAll(errors, graphErrors);

  // 5. Deterministic output: values and errors in declaration order.
  const values = namespace.inOrder(resolved);
  namespace.sortByPosition(errors);

  return errors.length === 0 ? { ok: true, values } : { ok: false, values, errors };
}

/**
 * Own enumerable entries of `record`, or none when it is not an object (`null`, `undefined` or a
 * primitive from an untyped caller).
 */
function entries(record: unknown): [string, unknown][] {
  return typeof record === "object" && record !== null ? Object.entries(record) : [];
}
