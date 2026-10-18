import { describe, expect, test } from "bun:test";
import { evaluateExpression } from "./evaluate";
import { type Expr, parseFormula } from "./parser";

function parse(source: string): Expr {
  const result = parseFormula(source);
  if (!result.ok) throw new Error(`unexpected error: ${result.error.message}`);
  return result.expr;
}

function evaluate(source: string, values: Record<string, number> = {}) {
  const map = new Map(Object.entries(values));
  return evaluateExpression(parse(source), (name) => map.get(name));
}

describe("evaluateExpression", () => {
  test("waist / 4 + ease_waist in millimetres", () => {
    expect(evaluate("waist / 4 + ease_waist", { waist: 720, ease_waist: 10 })).toEqual({
      ok: true,
      value: 190,
    });
  });

  test("function calls", () => {
    const result = evaluate("max(a, 2) + sqrt(16) + sin(30)", { a: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeCloseTo(6.5, 10);
  });

  test("an unknown reference carries the name and its span", () => {
    expect(evaluate("1 + wiast / 4")).toEqual({
      ok: false,
      error: {
        kind: "unknown_reference",
        reference: "wiast",
        span: { start: 4, end: 9 },
        message: 'Unknown name "wiast"',
      },
    });
  });

  test.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "%p is an unknown reference with an empty lookup",
    (name) => {
      const result = evaluate(name);
      expect(result).toMatchObject({ ok: false, error: { kind: "unknown_reference", reference: name } });
    },
  );

  test("division by zero spans the divisor", () => {
    expect(evaluate("1 / (a - a)", { a: 3 })).toEqual({
      ok: false,
      error: { kind: "division_by_zero", span: { start: 4, end: 11 }, message: "Division by zero" },
    });
  });

  test("division by negative zero", () => {
    expect(evaluate("1 / -0")).toMatchObject({ ok: false, error: { kind: "division_by_zero" } });
  });

  test("zero divided by something is fine", () => {
    expect(evaluate("0 / 5")).toEqual({ ok: true, value: 0 });
  });

  test.each([
    ["sqrt(-1)", "sqrt", { start: 0, end: 8 }],
    ["1 + asin(2)", "asin", { start: 4, end: 11 }],
    ["acos(-1.5)", "acos", { start: 0, end: 10 }],
  ])("%p is an invalid result of %p", (source, fn, span) => {
    expect(evaluate(source)).toMatchObject({
      ok: false,
      error: { kind: "invalid_result", function: fn, span },
    });
  });

  test("an overflowing operation is an invalid result", () => {
    const big = "9".repeat(300);
    expect(evaluate(`${big} * ${big}`)).toMatchObject({
      ok: false,
      error: { kind: "invalid_result", function: null, span: { start: 0, end: 603 } },
    });
  });

  test("a non-finite value from the lookup is an invalid result", () => {
    expect(evaluate("a", { a: Number.NaN })).toMatchObject({
      ok: false,
      error: { kind: "invalid_result", function: null, span: { start: 0, end: 1 } },
    });
  });

  test("stops at the first error", () => {
    expect(evaluate("x + 1 / 0")).toMatchObject({
      ok: false,
      error: { kind: "unknown_reference", reference: "x" },
    });
  });
});
