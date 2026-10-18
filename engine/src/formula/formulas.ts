// Evaluates a set of measurements, parameters and named formulas in dependency order (ADR 0003).

import {
  circularDependencyError,
  duplicateNameError,
  failedDependencyError,
  type FormulaError,
  type InputSource,
  invalidNameError,
  invalidValueError,
  type Span,
  syntaxError,
  unknownReferenceError,
} from "./errors";
import { evaluateExpression } from "./evaluate";
import { isIdentifier } from "./lexer";
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

type Reference = { name: string; span: Span };
type ParsedFormula = { expr: Expr; refs: Reference[]; formulaRefs: Reference[] };

/**
 * Evaluates every formula in `input` once, in dependency order, whatever the declaration order.
 *
 * Measurements, parameters and formulas share one namespace. Problems are returned as errors,
 * never thrown: invalid or duplicate names, non-finite measurement or parameter values, parse
 * errors, unknown references, circular dependencies (one error per group of mutually dependent
 * formulas, naming a cycle in it), formulas that depend on a failed name, and evaluation errors. Errors are sorted by the declaration order
 * of the name they belong to (measurements, then parameters, then formulas).
 *
 * Pure: `input` is not mutated. Runs in time linear in the total formula length; each formula is
 * parsed and evaluated at most once.
 */
export function evaluateFormulas(input: FormulaInput): EvaluationResult {
  const errors: FormulaError[] = [];
  const failed = new Set<string>();

  const measurements = Object.entries(input.measurements);
  const parameters = Object.entries(input.parameters);
  const formulas = Object.entries(input.formulas);

  // Declaration index of each name (first occurrence) and every source it is declared in.
  const declarationIndex = new Map<string, number>();
  const sources = new Map<string, InputSource[]>();
  const declare = (entries: [string, unknown][], source: InputSource): void => {
    for (const [name] of entries) {
      if (!declarationIndex.has(name)) declarationIndex.set(name, declarationIndex.size);
      const list = sources.get(name);
      if (list === undefined) sources.set(name, [source]);
      else list.push(source);
    }
  };
  declare(measurements, "measurement");
  declare(parameters, "parameter");
  declare(formulas, "formula");

  const fail = (error: FormulaError): void => {
    errors.push(error);
    failed.add(error.name);
  };

  // 1. Names and values.
  for (const [name, list] of sources) {
    if (!isIdentifier(name)) {
      for (const source of list) fail(invalidNameError(name, source));
    } else if (list.length > 1) {
      fail(duplicateNameError(name, list));
    }
  }

  const resolved = new Map<string, number>();
  const checkValues = (entries: [string, unknown][], source: "measurement" | "parameter"): void => {
    for (const [name, value] of entries) {
      if (failed.has(name)) continue;
      if (typeof value === "number" && Number.isFinite(value)) resolved.set(name, value);
      else fail(invalidValueError(name, source));
    }
  };
  checkValues(measurements, "measurement");
  checkValues(parameters, "parameter");

  // 2. Parse. 3. Every referenced name must be declared somewhere (even if it failed).
  const parsed = new Map<string, ParsedFormula>();
  for (const [name, source] of formulas as [string, unknown][]) {
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
      if (!sources.has(ref.name)) fail({ ...unknownReferenceError(ref.name, ref.span), name });
    }
    parsed.set(name, { expr: result.expr, refs, formulaRefs: [] });
  }
  for (const formula of parsed.values()) {
    formula.formulaRefs = formula.refs.filter((ref) => parsed.has(ref.name));
  }

  // 4. Cycles, and the evaluation order (dependencies first). Each strongly connected group
  // of formulas is reported once, as the shortest cycle through its first-declared member;
  // the group's other members get `failed_dependency` on a reference into the group.
  const position = (name: string): number => declarationIndex.get(name) ?? Infinity;
  const order: string[] = [];
  for (const component of components(parsed)) {
    order.push(...component);

    const head = component.reduce((a, b) => (position(b) < position(a) ? b : a));
    const members = new Set(component);
    const cycle = cycleThrough(head, members, parsed);
    if (cycle === null) continue;

    const span = parsed.get(head)?.formulaRefs.find((ref) => ref.name === cycle[1])?.span;
    errors.push(circularDependencyError(cycle, span ?? { start: 0, end: 0 }));
    const onCycle = new Set(cycle);
    for (const member of component) {
      if (failed.has(member)) continue;
      failed.add(member);
      if (onCycle.has(member)) continue;
      const ref = parsed.get(member)?.formulaRefs.find((r) => members.has(r.name));
      if (ref !== undefined) errors.push(failedDependencyError(member, ref.name, ref.span));
    }
  }

  // 5. Evaluate each formula once.
  const lookup = (name: string): number | undefined => resolved.get(name);
  for (const name of order) {
    const formula = parsed.get(name);
    if (formula === undefined || failed.has(name)) continue;

    const failedRef = formula.refs.find((ref) => failed.has(ref.name));
    if (failedRef !== undefined) {
      fail(failedDependencyError(name, failedRef.name, failedRef.span));
      continue;
    }

    const result = evaluateExpression(formula.expr, lookup);
    if (result.ok) resolved.set(name, result.value);
    else fail({ ...result.error, name });
  }

  // 6. Deterministic output: values and errors in declaration order. `fromEntries` defines own
  // data properties, so a name such as `__proto__` is stored safely.
  const values = Object.fromEntries(
    [...declarationIndex.keys()].flatMap((name) => {
      const value = resolved.get(name);
      return value === undefined ? [] : [[name, value] as const];
    }),
  );
  const index = (error: FormulaError): number => declarationIndex.get(error.name) ?? Infinity;
  errors.sort((a, b) => index(a) - index(b));

  return errors.length === 0 ? { ok: true, values } : { ok: false, values, errors };
}

type Frame = { name: string; next: number };

/**
 * Splits the formula-to-formula reference graph into strongly connected components with an
 * iterative Tarjan search, so the call stack does not grow with the number of formulas. Components
 * come out dependencies first, which is the evaluation order. Linear in formulas + references.
 */
function components(parsed: ReadonlyMap<string, ParsedFormula>): string[][] {
  const result: string[][] = [];
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const componentStack: string[] = [];
  const onComponentStack = new Set<string>();

  const visit = (name: string, frames: Frame[]): void => {
    index.set(name, index.size);
    low.set(name, index.size - 1);
    componentStack.push(name);
    onComponentStack.add(name);
    frames.push({ name, next: 0 });
  };
  const lower = (name: string, candidate: number): void => {
    if (candidate < (low.get(name) ?? Infinity)) low.set(name, candidate);
  };

  for (const root of parsed.keys()) {
    if (index.has(root)) continue;
    const frames: Frame[] = [];
    visit(root, frames);

    for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
      const ref = parsed.get(frame.name)?.formulaRefs[frame.next];
      if (ref !== undefined) {
        frame.next++;
        const refIndex = index.get(ref.name);
        if (refIndex === undefined) visit(ref.name, frames);
        else if (onComponentStack.has(ref.name)) lower(frame.name, refIndex);
        continue;
      }

      frames.pop();
      const frameLow = low.get(frame.name) ?? Infinity;
      const parent = frames.at(-1);
      if (parent !== undefined) lower(parent.name, frameLow);

      if (frameLow === index.get(frame.name)) {
        const component: string[] = [];
        for (let member = componentStack.pop(); member !== undefined; member = componentStack.pop()) {
          onComponentStack.delete(member);
          component.push(member);
          if (member === frame.name) break;
        }
        result.push(component);
      }
    }
  }

  return result;
}

/**
 * The shortest cycle through `head` within `members` (a strongly connected component), found
 * with a breadth-first search following references in order of appearance. Returned closed, e.g.
 * `["a", "b", "a"]`, or `null` when `head` is not on a cycle (a single formula that does not
 * reference itself).
 */
function cycleThrough(
  head: string,
  members: ReadonlySet<string>,
  parsed: ReadonlyMap<string, ParsedFormula>,
): string[] | null {
  const previous = new Map<string, string>();
  const queue = [head];

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i] ?? head;
    for (const ref of parsed.get(current)?.formulaRefs ?? []) {
      if (ref.name === head) {
        const path = [current];
        for (let node = previous.get(current); node !== undefined; node = previous.get(node)) {
          path.push(node);
        }
        path.reverse();
        // `path` runs from `head` to the member that references it.
        return [...path, head];
      }
      if (members.has(ref.name) && ref.name !== head && !previous.has(ref.name)) {
        previous.set(ref.name, current);
        queue.push(ref.name);
      }
    }
  }

  return null;
}
