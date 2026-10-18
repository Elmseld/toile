import { describe, expect, test } from "bun:test";
import { evaluateExpression } from "../formula/evaluate";
import { FUNCTIONS } from "../formula/functions";
import { parseFormula } from "../formula/parser";
import { type GeometryState, geometryFunctions, NAME_ARGUMENT_KINDS } from "./functions";
import type { ComputedCurve } from "./types";
import type { Point } from "./vector";

const state: GeometryState = {
  points: new Map<string, Point>([
    ["A", { x: 0, y: 0 }],
    ["B", { x: 30, y: 40 }],
    ["C", { x: 0, y: -10 }],
    ["D", { x: 30, y: 40 }],
  ]),
  curves: new Map<string, ComputedCurve>([
    ["c", { name: "c", type: "line", from: { x: 0, y: 0 }, to: { x: 30, y: 40 }, length: 50 }],
  ]),
};
const functions = geometryFunctions(state);
const values = new Map([["w", 2]]);

function evaluate(source: string) {
  const parsed = parseFormula(source, { functions });
  if (!parsed.ok) return { ok: false as const, error: parsed.error };
  return evaluateExpression(parsed.expr, (name) => values.get(name), { functions });
}

describe("geometryFunctions", () => {
  test("distance, angle and length through evaluateExpression", () => {
    expect(evaluate("distance(A, B)")).toEqual({ ok: true, value: 50 });
    expect(evaluate("angle(A, C)")).toEqual({ ok: true, value: 270 });
    const angle = evaluate("angle(A, B)");
    expect(angle.ok && angle.value).toBeCloseTo((Math.atan2(40, 30) * 180) / Math.PI, 9);
    expect(evaluate("length(c) * w + distance(B, A)")).toEqual({ ok: true, value: 150 });
  });

  test("keeps the built-in functions", () => {
    expect(evaluate("sqrt(distance(A, B) - 41) + max(1, w)")).toEqual({ ok: true, value: 5 });
  });

  test("the angle of coincident points is invalid_result on the call", () => {
    expect(evaluate("1 + angle(B, D)")).toEqual({
      ok: false,
      error: {
        kind: "invalid_result",
        function: "angle",
        span: { start: 4, end: 15 },
        message: expect.any(String),
      },
    });
  });

  test("a name missing from the state gives invalid_result rather than throwing", () => {
    expect(evaluate("distance(A, Z)")).toMatchObject({ ok: false, error: { kind: "invalid_result" } });
    expect(evaluate("length(nope)")).toMatchObject({ ok: false, error: { kind: "invalid_result" } });
  });

  test("an expression where a name is expected is invalid_argument at parse", () => {
    expect(parseFormula("distance(A, 1)", { functions })).toMatchObject({
      ok: false,
      error: { kind: "invalid_argument", function: "distance", span: { start: 12, end: 13 } },
    });
    expect(parseFormula("length(c, c)", { functions })).toMatchObject({
      ok: false,
      error: { kind: "wrong_argument_count" },
    });
  });

  test("FUNCTIONS itself is unchanged", () => {
    expect(FUNCTIONS.has("distance")).toBe(false);
    expect(FUNCTIONS.has("angle")).toBe(false);
    expect(FUNCTIONS.has("length")).toBe(false);
    expect(functions.size).toBe(FUNCTIONS.size + 3);
  });

  test("NAME_ARGUMENT_KINDS", () => {
    expect([...NAME_ARGUMENT_KINDS]).toEqual([
      ["distance", "point"],
      ["angle", "point"],
      ["length", "curve"],
    ]);
  });
});
