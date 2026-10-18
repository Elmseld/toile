// Evaluator for parsed formulas. Pure: walks the AST and resolves names through `lookup`.

import {
  divisionByZeroError,
  type ExpressionError,
  invalidArgumentError,
  invalidResultError,
  type Span,
  unknownFunctionError,
  unknownReferenceError,
  wrongArgumentCountError,
} from "./errors";
import { FUNCTIONS, type FunctionSpec, type FunctionTable } from "./functions";
import type { Expr, FormulaOptions } from "./parser";

export type ExpressionResult = { ok: true; value: number } | { ok: false; error: ExpressionError };

type CallExpr = Extract<Expr, { type: "call" }>;

// A node still to be evaluated, or one whose operands are evaluated and on the value stack.
type Task =
  | { step: "visit"; expr: Expr }
  | { step: "negate" }
  | { step: "binary"; expr: Extract<Expr, { type: "binary" }> }
  | { step: "call"; expr: CallExpr; spec: FunctionSpec };

/**
 * Evaluates `expr`, resolving every reference through `lookup` (`undefined` means the name is
 * unknown). `lookup` is a function rather than a map so callers such as geometry can resolve
 * names their own way. Calls go through `options.functions` (default `FUNCTIONS`); arguments of a
 * function that takes names are passed to it unevaluated, without `lookup`.
 *
 * Stops at the first error, evaluating left to right: an unknown reference, a division by zero
 * (span of the divisor), a non-finite result such as `sqrt(-1)` (span of the operation), or a call
 * that does not match the function table. A function from the table that throws is an
 * `invalid_result` error for that call. Never throws, also not for hand-built ASTs of any depth
 * (the walk uses an explicit stack instead of recursion) or with malformed nodes, such as nodes of
 * an unknown type or calls without an `args` array of nodes (`invalid_result`).
 */
export function evaluateExpression(
  expr: Expr,
  lookup: (name: string) => number | undefined,
  options: FormulaOptions = {},
): ExpressionResult {
  const functions = options.functions ?? FUNCTIONS;
  const values: number[] = [];
  const tasks: Task[] = [{ step: "visit", expr }];
  // Every apply step pops exactly the operands its visit step pushed, so `pop()` never comes
  // back empty; `?? NaN` is only there for the type checker.
  const pop = (): number => values.pop() ?? Number.NaN;

  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    switch (task.step) {
      case "visit": {
        const node = task.expr;
        // Hand-built ASTs may hold anything; `null` would otherwise throw on `.type`.
        if (typeof node !== "object" || node === null) return fail(invalidResultError(null, NO_SPAN));
        switch (node.type) {
          case "number":
            if (!Number.isFinite(node.value)) return fail(invalidResultError(null, node.span));
            values.push(node.value);
            break;

          case "reference": {
            const value = lookup(node.name);
            if (value === undefined) return fail(unknownReferenceError(node.name, node.span));
            if (!Number.isFinite(value)) return fail(invalidResultError(null, node.span));
            values.push(value);
            break;
          }

          case "negate":
            tasks.push({ step: "negate" }, { step: "visit", expr: node.operand });
            break;

          case "binary":
            // Pushed in reverse so the left operand is evaluated (and fails) first.
            tasks.push(
              { step: "binary", expr: node },
              { step: "visit", expr: node.right },
              { step: "visit", expr: node.left },
            );
            break;

          case "call": {
            // Hand-built calls may lack an `args` array or hold holes and non-objects in it;
            // checking here keeps `checkCall` and the argument count below sound.
            if (!wellFormedArgs(node.args)) return fail(invalidResultError(null, spanOf(node)));
            const spec = checkCall(node, functions);
            if (!spec.ok) return spec;
            tasks.push({ step: "call", expr: node, spec: spec.value });
            if (spec.value.takes !== "names") {
              for (let i = node.args.length - 1; i >= 0; i--) {
                // `wellFormedArgs` checked every index; `as Expr` is only for the type checker.
                tasks.push({ step: "visit", expr: node.args[i] as Expr });
              }
            }
            break;
          }

          default:
            // Only reachable for hand-built nodes of an unknown type.
            return fail(invalidResultError(null, spanOf(node)));
        }
        break;
      }

      case "negate":
        values.push(-pop());
        break;

      case "binary": {
        const right = pop();
        const left = pop();
        // `=== 0` is also true for -0.
        if (task.expr.op === "/" && right === 0) {
          return fail(divisionByZeroError(task.expr.right.span));
        }
        const value = applyOperator(task.expr.op, left, right);
        if (!Number.isFinite(value)) return fail(invalidResultError(null, task.expr.span));
        values.push(value);
        break;
      }

      case "call": {
        const { expr: call, spec } = task;
        const value = applyFunction(spec, call, values);
        if (!Number.isFinite(value)) return fail(invalidResultError(call.function, call.span));
        values.push(value);
        break;
      }
    }
  }

  // Every task above pushes or fails, so exactly one finite value is left; checked anyway so a
  // malformed hand-built AST can never come back as `ok` with a non-finite value.
  const [value] = values;
  if (values.length !== 1 || value === undefined || !Number.isFinite(value)) {
    return fail(invalidResultError(null, spanOf(expr)));
  }
  return { ok: true, value };
}

/**
 * Whether `args` is an array whose every index holds an object. A plain loop rather than `every`,
 * which skips the holes of a sparse array.
 */
function wellFormedArgs(args: unknown): boolean {
  if (!Array.isArray(args)) return false;
  for (let i = 0; i < args.length; i++) {
    const arg: unknown = args[i];
    if (typeof arg !== "object" || arg === null) return false;
  }
  return true;
}

/** Checks a call against the function table, as the parser does for parsed formulas. */
function checkCall(
  call: CallExpr,
  functions: FunctionTable,
): { ok: true; value: FunctionSpec } | { ok: false; error: ExpressionError } {
  const spec = functions.get(call.function);
  if (spec === undefined) return fail(unknownFunctionError(call.function, call.span));

  const count = call.args.length;
  if (count < spec.min || (spec.max !== null && count > spec.max)) {
    return fail(wrongArgumentCountError(call.function, spec.min, spec.max, count, call.span));
  }
  if (spec.takes === "names") {
    const notName = call.args.find((arg) => arg.type !== "reference");
    if (notName !== undefined) return fail(invalidArgumentError(call.function, notName.span));
  }
  return { ok: true, value: spec };
}

/**
 * Applies `spec`, taking its evaluated arguments (if any) off the end of `values`. A throwing
 * `apply` (caller-supplied functions may) gives `NaN`, which the caller reports as `invalid_result`.
 */
function applyFunction(spec: FunctionSpec, call: CallExpr, values: number[]): number {
  const args = spec.takes === "names" ? [] : values.splice(values.length - call.args.length);
  try {
    if (spec.takes === "names") {
      // `checkCall` made sure every argument is a reference.
      return spec.apply(call.args.map((arg) => (arg.type === "reference" ? arg.name : "")));
    }
    return spec.apply(args);
  } catch {
    return Number.NaN;
  }
}

const NO_SPAN: Span = { start: 0, end: 0 };

/** The span of a node, or an empty one for a hand-built node without one. */
function spanOf(node: unknown): Span {
  const span = (node as { span?: unknown } | null)?.span;
  return typeof span === "object" && span !== null ? (span as Span) : NO_SPAN;
}

function applyOperator(op: "+" | "-" | "*" | "/", left: number, right: number): number {
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return left / right;
  }
}

function fail(error: ExpressionError): { ok: false; error: ExpressionError } {
  return { ok: false, error };
}
