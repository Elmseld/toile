import { describe, expect, test } from "bun:test";
import { evaluateExpression } from "./evaluate";
import type { FunctionSpec, FunctionTable } from "./functions";
import { type Expr, MAX_FORMULA_LENGTH, MAX_NESTING_DEPTH, parseFormula, references } from "./parser";

function parse(source: string): Expr {
  const result = parseFormula(source);
  if (!result.ok) throw new Error(`unexpected error: ${result.error.message}`);
  return result.expr;
}

function value(source: string): number {
  const result = evaluateExpression(parse(source), () => undefined);
  if (!result.ok) throw new Error(`unexpected error: ${result.error.message}`);
  return result.value;
}

function parseError(source: string) {
  const result = parseFormula(source);
  if (result.ok) throw new Error(`expected an error for ${JSON.stringify(source.slice(0, 40))}`);
  return result.error;
}

describe("parseFormula", () => {
  test("precedence", () => {
    expect(value("1 + 2 * 3")).toBe(7);
    expect(value("(1 + 2) * 3")).toBe(9);
    expect(value("8 - 6 / 2")).toBe(5);
  });

  test("left associativity", () => {
    expect(value("10 - 4 - 3")).toBe(3);
    expect(value("24 / 4 / 2")).toBe(3);
  });

  test("unary minus", () => {
    expect(value("-2 * 3")).toBe(-6);
    expect(value("2 * -3")).toBe(-6);
    expect(value("--4")).toBe(4);
    expect(value("-(1 + 2)")).toBe(-3);
    expect(value("1 - -1")).toBe(2);
  });

  test("a reference with its span", () => {
    expect(parse("  waist ")).toEqual({
      type: "reference",
      name: "waist",
      span: { start: 2, end: 7 },
    });
  });

  test("binary and call spans", () => {
    expect(parse("a / 4 + max(b, 2)")).toEqual({
      type: "binary",
      op: "+",
      span: { start: 0, end: 17 },
      left: {
        type: "binary",
        op: "/",
        span: { start: 0, end: 5 },
        left: { type: "reference", name: "a", span: { start: 0, end: 1 } },
        right: { type: "number", value: 4, span: { start: 4, end: 5 } },
      },
      right: {
        type: "call",
        function: "max",
        span: { start: 8, end: 17 },
        args: [
          { type: "reference", name: "b", span: { start: 12, end: 13 } },
          { type: "number", value: 2, span: { start: 15, end: 16 } },
        ],
      },
    });
  });

  test("a parenthesized expression's span includes the parentheses", () => {
    expect(parse("2 * (a - b)")).toMatchObject({ right: { span: { start: 4, end: 11 } } });
  });

  test("a function call may have whitespace before the parenthesis", () => {
    expect(value("sqrt (16)")).toBe(4);
  });

  test("a function name without parentheses is a reference", () => {
    expect(parse("deg")).toEqual({ type: "reference", name: "deg", span: { start: 0, end: 3 } });
    expect(value("deg(rad(90))")).toBeCloseTo(90, 10);
  });

  test("an unknown function is reported at its name", () => {
    expect(parseError("1 + foo(1)")).toEqual({
      kind: "unknown_function",
      function: "foo",
      span: { start: 4, end: 7 },
      message: 'Unknown function "foo"',
    });
  });

  test("prototype member names are not functions", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(parseError(`${name}(1)`)).toMatchObject({ kind: "unknown_function", function: name });
    }
  });

  test("wrong argument counts span the whole call", () => {
    expect(parseError("sqrt(1, 2)")).toMatchObject({
      kind: "wrong_argument_count",
      function: "sqrt",
      min: 1,
      max: 1,
      received: 2,
      span: { start: 0, end: 10 },
    });
    expect(parseError("1 + atan2(1)")).toMatchObject({
      kind: "wrong_argument_count",
      function: "atan2",
      min: 2,
      max: 2,
      received: 1,
      span: { start: 4, end: 12 },
    });
    expect(parseError("min()")).toMatchObject({
      kind: "wrong_argument_count",
      function: "min",
      min: 1,
      max: null,
      received: 0,
      message: "min() expects at least 1 argument, got 0",
    });
  });

  test.each([
    ["", { start: 0, end: 0 }, "Empty formula"],
    ["  \n ", { start: 0, end: 4 }, "Empty formula"],
    ["2 +", { start: 3, end: 3 }, "Unexpected end of formula"],
    ["2 3", { start: 2, end: 3 }, "Unexpected number 3"],
    ["2(a)", { start: 1, end: 2 }, 'Unexpected "("'],
    ["* 2", { start: 0, end: 1 }, 'Unexpected "*"'],
    ["(1 + 2", { start: 6, end: 6 }, 'Missing ")" at end of formula'],
    ["(1 + 2 3)", { start: 7, end: 8 }, "Unexpected number 3"],
    ["1 + 2)", { start: 5, end: 6 }, 'Unexpected ")"'],
    ["max(1,)", { start: 6, end: 7 }, 'Unexpected ")"'],
    ["a b", { start: 2, end: 3 }, 'Unexpected name "b"'],
    ["1.", { start: 0, end: 2 }, 'Malformed number "1."'],
    ["a $ b", { start: 2, end: 3 }, 'Unexpected character "$"'],
  ])("syntax error in %p", (source, span, message) => {
    expect(parseError(source)).toEqual({ kind: "syntax", span, message });
  });

  test("exactly MAX_NESTING_DEPTH levels of parentheses parse", () => {
    const source = `${"(".repeat(MAX_NESTING_DEPTH)}1${")".repeat(MAX_NESTING_DEPTH)}`;
    expect(value(source)).toBe(1);
  });

  test("one level deeper is a syntax error at the offending parenthesis", () => {
    const depth = MAX_NESTING_DEPTH + 1;
    const source = `${"(".repeat(depth)}1${")".repeat(depth)}`;
    expect(parseError(source)).toEqual({
      kind: "syntax",
      span: { start: MAX_NESTING_DEPTH, end: MAX_NESTING_DEPTH + 1 },
      message: "Formula is nested too deeply",
    });
  });

  test("deep nesting of calls and unary minus is limited", () => {
    expect(value(`${"-".repeat(MAX_NESTING_DEPTH)}1`)).toBe(1);
    expect(parseError(`${"-".repeat(MAX_NESTING_DEPTH + 1)}1`).message).toBe(
      "Formula is nested too deeply",
    );
    const calls = `${"abs(".repeat(MAX_NESTING_DEPTH + 1)}1${")".repeat(MAX_NESTING_DEPTH + 1)}`;
    expect(parseError(calls).message).toBe("Formula is nested too deeply");
  });

  test("10 000 opening parentheses do not throw", () => {
    expect(parseError("(".repeat(10_000)).message).toBe("Formula is nested too deeply");
  });

  test("formulas longer than MAX_FORMULA_LENGTH are rejected before parsing", () => {
    const source = "1".repeat(MAX_FORMULA_LENGTH + 1);
    expect(parseError(source)).toEqual({
      kind: "syntax",
      span: { start: 0, end: MAX_FORMULA_LENGTH + 1 },
      message: "Formula is too long",
    });
  });

  test("a long binary chain within the length limit parses", () => {
    const terms = MAX_FORMULA_LENGTH / 2 - 1;
    const source = `${"1+".repeat(terms)}11`;
    expect(source.length).toBe(MAX_FORMULA_LENGTH);
    expect(value(source)).toBe(terms + 11);
    expect(value(source.replaceAll("+", "*"))).toBe(11);
  });
});

describe("references", () => {
  test("distinct names in order of first appearance, with the first span", () => {
    expect(references(parse("b + max(a, b * c) - a"))).toEqual([
      { name: "b", span: { start: 0, end: 1 } },
      { name: "a", span: { start: 8, end: 9 } },
      { name: "c", span: { start: 15, end: 16 } },
    ]);
  });

  test("function names are not references", () => {
    expect(references(parse("sqrt(16) + -x"))).toEqual([{ name: "x", span: { start: 12, end: 13 } }]);
  });

  test("a number has no references", () => {
    expect(references(parse("42"))).toEqual([]);
  });
});

describe("parseFormula with a custom function table", () => {
  const functions: FunctionTable = new Map<string, FunctionSpec>([
    ["double", { min: 1, max: 1, apply: (args) => 2 * (args[0] ?? Number.NaN) }],
    ["distance", { min: 2, max: 2, takes: "names", apply: () => 0 }],
  ]);

  test("calls are checked against the given table", () => {
    expect(parseFormula("double(2) + distance(A, B)", { functions }).ok).toBe(true);
    expect(parseFormula("sqrt(4)", { functions })).toMatchObject({
      ok: false,
      error: { kind: "unknown_function", function: "sqrt" },
    });
    expect(parseFormula("distance(A)", { functions })).toMatchObject({
      ok: false,
      error: { kind: "wrong_argument_count", function: "distance", min: 2, max: 2, received: 1 },
    });
  });

  test("the built-in table is the default", () => {
    expect(parseError("double(2)")).toMatchObject({ kind: "unknown_function", function: "double" });
  });

  test("a function that takes names rejects other arguments", () => {
    expect(parseFormula("distance(A, B + 1)", { functions })).toEqual({
      ok: false,
      error: {
        kind: "invalid_argument",
        function: "distance",
        span: { start: 12, end: 17 },
        message: "distance() expects a name here",
      },
    });
    expect(parseFormula("distance(2, B)", { functions })).toMatchObject({
      ok: false,
      error: { kind: "invalid_argument", span: { start: 9, end: 10 } },
    });
  });

  test("name arguments are references, so they count as dependencies", () => {
    const result = parseFormula("distance(A, B) + m", { functions });
    if (!result.ok) throw new Error("unexpected parse error");
    expect(references(result.expr).map((ref) => ref.name)).toEqual(["A", "B", "m"]);
  });
});
