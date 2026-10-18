// Evaluator for parsed formulas. Pure: walks the AST and resolves names through `lookup`.

import {
  divisionByZeroError,
  type ExpressionError,
  invalidResultError,
  unknownReferenceError,
} from "./errors";
import { FUNCTIONS } from "./functions";
import type { Expr } from "./parser";

export type ExpressionResult = { ok: true; value: number } | { ok: false; error: ExpressionError };

/**
 * Evaluates `expr`, resolving every reference through `lookup` (`undefined` means the name is
 * unknown). `lookup` is a function rather than a map so callers such as geometry can resolve
 * names their own way.
 *
 * Stops at the first error: an unknown reference, a division by zero (span of the divisor) or a
 * non-finite result such as `sqrt(-1)` (span of the operation). Never throws.
 */
export function evaluateExpression(
  expr: Expr,
  lookup: (name: string) => number | undefined,
): ExpressionResult {
  switch (expr.type) {
    case "number":
      return { ok: true, value: expr.value };

    case "reference": {
      const value = lookup(expr.name);
      if (value === undefined) return fail(unknownReferenceError(expr.name, expr.span));
      return finite(value, null, expr);
    }

    case "negate": {
      const operand = evaluateExpression(expr.operand, lookup);
      if (!operand.ok) return operand;
      return { ok: true, value: -operand.value };
    }

    case "binary": {
      const left = evaluateExpression(expr.left, lookup);
      if (!left.ok) return left;
      const right = evaluateExpression(expr.right, lookup);
      if (!right.ok) return right;
      // `=== 0` is also true for -0.
      if (expr.op === "/" && right.value === 0) {
        return fail(divisionByZeroError(expr.right.span));
      }
      return finite(applyOperator(expr.op, left.value, right.value), null, expr);
    }

    case "call": {
      const spec = FUNCTIONS.get(expr.function);
      // The parser only produces calls to known functions; this guards hand-built ASTs.
      if (spec === undefined) return fail(invalidResultError(expr.function, expr.span));
      const args: number[] = [];
      for (const arg of expr.args) {
        const result = evaluateExpression(arg, lookup);
        if (!result.ok) return result;
        args.push(result.value);
      }
      return finite(spec.apply(args), expr.function, expr);
    }
  }
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

function finite(value: number, functionName: string | null, expr: Expr): ExpressionResult {
  if (!Number.isFinite(value)) return fail(invalidResultError(functionName, expr.span));
  return { ok: true, value };
}

function fail(error: ExpressionError): { ok: false; error: ExpressionError } {
  return { ok: false, error };
}
