import { describe, expect, test } from "bun:test";
import { FUNCTIONS } from "../formula/functions";
import { type Expr, parseFormula } from "../formula/parser";
import { geometryFunctions } from "./functions";
import { classifyReferences } from "./references";

const functions = geometryFunctions({ points: new Map(), curves: new Map() });

function parse(source: string): Expr {
  const result = parseFormula(source, { functions });
  if (!result.ok) throw new Error(result.error.message);
  return result.expr;
}

const kinds = (source: string) =>
  classifyReferences(parse(source), functions).map(({ name, kind }) => [name, kind]);

describe("classifyReferences", () => {
  test("geometry function arguments get their kind, everything else is a value", () => {
    expect(kinds("width + distance(A, B) * length(c)")).toEqual([
      ["width", "value"],
      ["A", "point"],
      ["B", "point"],
      ["c", "curve"],
    ]);
  });

  test("spans point into the source", () => {
    expect(classifyReferences(parse("angle(A, Bc)"), functions)).toEqual([
      { name: "A", span: { start: 6, end: 7 }, kind: "point" },
      { name: "Bc", span: { start: 9, end: 11 }, kind: "point" },
    ]);
  });

  test("nested calls, source order and duplicates", () => {
    expect(kinds("max(distance(A, B), length(c), -w, A)")).toEqual([
      ["A", "point"],
      ["B", "point"],
      ["c", "curve"],
      ["w", "value"],
      ["A", "value"],
    ]);
    expect(kinds("distance(A, A)")).toEqual([
      ["A", "point"],
      ["A", "point"],
    ]);
  });

  test("a function that does not take names in the given table classifies as values", () => {
    const expr: Expr = {
      type: "call",
      function: "distance",
      args: [{ type: "reference", name: "A", span: { start: 9, end: 10 } }],
      span: { start: 0, end: 11 },
    };
    expect(classifyReferences(expr, FUNCTIONS)).toEqual([
      { name: "A", span: { start: 9, end: 10 }, kind: "value" },
    ]);
  });

  test("a 100-level expression", () => {
    let source = "length(c)";
    for (let i = 0; i < 99; i++) source = `(${source} + a${i})`;
    const result = kinds(source);
    expect(result).toHaveLength(100);
    expect(result[0]).toEqual(["c", "curve"]);
    expect(result[99]).toEqual(["a98", "value"]);
  });

  test("a hand-built AST much deeper than the parser allows", () => {
    let expr: Expr = { type: "reference", name: "x", span: { start: 0, end: 1 } };
    for (let i = 0; i < 100_000; i++) expr = { type: "negate", operand: expr, span: expr.span };
    expect(classifyReferences(expr, functions)).toEqual([
      { name: "x", span: { start: 0, end: 1 }, kind: "value" },
    ]);
  });
});
