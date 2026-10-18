import { describe, expect, test } from "bun:test";
import { evaluateExpression } from "./evaluate";
import { FUNCTIONS, type FunctionSpec, type FunctionTable } from "./functions";
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

describe("evaluateExpression on hand-built ASTs", () => {
  const span = { start: 0, end: 1 };

  test("a very deep AST is evaluated without overflowing the stack", () => {
    let expr: Expr = { type: "number", value: 1, span };
    for (let i = 0; i < 1_000_000; i++) expr = { type: "negate", operand: expr, span };
    expect(evaluateExpression(expr, () => undefined)).toEqual({ ok: true, value: 1 });
  });

  test("a very deep left-leaning sum is evaluated left to right", () => {
    let expr: Expr = { type: "number", value: 0, span };
    for (let i = 0; i < 200_000; i++) {
      expr = { type: "binary", op: "+", left: expr, right: { type: "number", value: 1, span }, span };
    }
    expect(evaluateExpression(expr, () => undefined)).toEqual({ ok: true, value: 200_000 });
  });

  test("a call to an unknown function is an unknown_function error", () => {
    const expr: Expr = { type: "call", function: "nope", args: [], span: { start: 0, end: 6 } };
    expect(evaluateExpression(expr, () => undefined)).toEqual({
      ok: false,
      error: {
        kind: "unknown_function",
        function: "nope",
        span: { start: 0, end: 6 },
        message: 'Unknown function "nope"',
      },
    });
  });

  test("a call with the wrong number of arguments is a wrong_argument_count error", () => {
    const expr: Expr = { type: "call", function: "sqrt", args: [], span };
    expect(evaluateExpression(expr, () => undefined)).toMatchObject({
      ok: false,
      error: { kind: "wrong_argument_count", function: "sqrt", min: 1, max: 1, received: 0 },
    });
  });

  test("a node of an unknown type is an invalid result, never ok with NaN", () => {
    const unknown = { type: "mystery", span: { start: 4, end: 5 } } as unknown as Expr;
    const expr: Expr = { type: "binary", op: "+", left: { type: "number", value: 1, span }, right: unknown, span };
    expect(evaluateExpression(expr, () => undefined)).toMatchObject({
      ok: false,
      error: { kind: "invalid_result", function: null, span: { start: 4, end: 5 } },
    });
    expect(evaluateExpression({ type: "mystery" } as unknown as Expr, () => undefined)).toMatchObject({
      ok: false,
      error: { kind: "invalid_result", function: null, span: { start: 0, end: 0 } },
    });
  });

  test("a missing node is an invalid result", () => {
    const expr = { type: "negate", operand: null, span } as unknown as Expr;
    expect(evaluateExpression(expr, () => undefined)).toMatchObject({
      ok: false,
      error: { kind: "invalid_result", function: null },
    });
  });

  test("min and max with a million arguments do not overflow the stack", () => {
    const args: Expr[] = Array.from({ length: 1_000_000 }, (_, i) => ({ type: "number", value: i, span }));
    expect(evaluateExpression({ type: "call", function: "min", args, span }, () => undefined)).toEqual({
      ok: true,
      value: 0,
    });
    expect(evaluateExpression({ type: "call", function: "max", args, span }, () => undefined)).toEqual({
      ok: true,
      value: 999_999,
    });
  });

  test("a non-finite number node is an invalid result", () => {
    const expr: Expr = { type: "number", value: Number.POSITIVE_INFINITY, span };
    expect(evaluateExpression(expr, () => undefined)).toMatchObject({
      ok: false,
      error: { kind: "invalid_result", function: null },
    });
  });
});

describe("evaluateExpression with a custom function table", () => {
  const points = new Map([
    ["A", { x: 0, y: 0 }],
    ["B", { x: 30, y: 40 }],
  ]);
  const functions: FunctionTable = new Map<string, FunctionSpec>([
    ...FUNCTIONS,
    ["twice", { min: 1, max: 1, apply: (args) => 2 * (args[0] ?? Number.NaN) }],
    [
      "distance",
      {
        min: 2,
        max: 2,
        takes: "names",
        apply: ([a = "", b = ""]) => {
          const p = points.get(a);
          const q = points.get(b);
          return p && q ? Math.hypot(q.x - p.x, q.y - p.y) : Number.NaN;
        },
      },
    ],
  ]);

  function run(source: string, values: Record<string, number> = {}) {
    const parsed = parseFormula(source, { functions });
    if (!parsed.ok) throw new Error(`unexpected error: ${parsed.error.message}`);
    const map = new Map(Object.entries(values));
    const looked: string[] = [];
    const result = evaluateExpression(
      parsed.expr,
      (name) => {
        looked.push(name);
        return map.get(name);
      },
      { functions },
    );
    return { result, looked };
  }

  test("number functions from the table are called with evaluated arguments", () => {
    expect(run("twice(m + 1) + sqrt(4)", { m: 2 }).result).toEqual({ ok: true, value: 8 });
  });

  test("name arguments are passed unevaluated, not through lookup", () => {
    const { result, looked } = run("distance(A, B) / 2 + m", { m: 1 });
    expect(result).toEqual({ ok: true, value: 26 });
    expect(looked).toEqual(["m"]);
  });

  test("a non-finite result of a name function is an invalid result", () => {
    expect(run("1 + distance(A, C)").result).toMatchObject({
      ok: false,
      error: { kind: "invalid_result", function: "distance", span: { start: 4, end: 18 } },
    });
  });

  test("a hand-built call with an expression where a name is expected is an invalid_argument error", () => {
    const expr: Expr = {
      type: "call",
      function: "distance",
      args: [
        { type: "reference", name: "A", span: { start: 9, end: 10 } },
        { type: "number", value: 1, span: { start: 12, end: 13 } },
      ],
      span: { start: 0, end: 14 },
    };
    expect(evaluateExpression(expr, () => undefined, { functions })).toEqual({
      ok: false,
      error: {
        kind: "invalid_argument",
        function: "distance",
        span: { start: 12, end: 13 },
        message: "distance() expects a name here",
      },
    });
  });

  test("a throwing function from the table is an invalid result for that call", () => {
    const throwing: FunctionTable = new Map<string, FunctionSpec>([
      ...functions,
      ["boom", { min: 1, max: 1, apply: () => { throw new Error("boom"); } }],
      ["named_boom", { min: 1, max: 1, takes: "names", apply: () => { throw new Error("boom"); } }],
    ]);
    for (const [source, name] of [["1 + boom(2)", "boom"], ["1 + named_boom(A)", "named_boom"]] as const) {
      const parsed = parseFormula(source, { functions: throwing });
      if (!parsed.ok) throw new Error("unexpected parse error");
      expect(evaluateExpression(parsed.expr, () => 1, { functions: throwing })).toMatchObject({
        ok: false,
        error: { kind: "invalid_result", function: name, span: { start: 4, end: source.length } },
      });
    }
  });

  test("a hand-built call without a well-formed args array is an invalid result", () => {
    const span = { start: 0, end: 1 };
    const callSpan = { start: 2, end: 9 };
    const one: Expr = { type: "number", value: 1, span };
    const a: Expr = { type: "reference", name: "A", span };
    const calls = [
      { type: "call", function: "sqrt", span: callSpan },
      { type: "call", function: "sqrt", args: null, span: callSpan },
      { type: "call", function: "distance", args: [a, null], span: callSpan },
      { type: "call", function: "max", args: [one, 2], span: callSpan },
      // A sparse array: the hole must not be skipped, which would also leave the count wrong.
      { type: "call", function: "max", args: [one, , one], span: callSpan },
    ] as unknown as Expr[];
    for (const call of calls) {
      const nested: Expr = { type: "negate", operand: call, span };
      for (const expr of [call, nested]) {
        expect(() => evaluateExpression(expr, () => 1, { functions })).not.toThrow();
        expect(evaluateExpression(expr, () => 1, { functions })).toEqual({
          ok: false,
          error: expect.objectContaining({ kind: "invalid_result", function: null, span: callSpan }),
        });
      }
    }
  });

  test("a function missing from the table given is unknown", () => {
    const parsed = parseFormula("twice(1)", { functions });
    if (!parsed.ok) throw new Error("unexpected parse error");
    expect(evaluateExpression(parsed.expr, () => undefined)).toMatchObject({
      ok: false,
      error: { kind: "unknown_function", function: "twice" },
    });
  });
});
