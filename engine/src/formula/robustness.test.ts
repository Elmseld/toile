import { describe, expect, test } from "bun:test";
import { evaluateFormulas } from "./formulas";
import { parseFormula } from "./parser";

// Deterministic pseudo-random generator (mulberry32) so the fuzz tests never flake.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  "(", ")", ",", "+", "-", "*", "/", " ", "\t", "\n", ".", "1", "0", "2.5", "a", "b", "waist",
  "sqrt", "min", "max", "atan2", "deg", "foo", "__proto__", "constructor", "$", "é", "😀", "=", "^",
];

function randomSource(next: () => number): string {
  const length = Math.floor(next() * 24);
  let source = "";
  for (let i = 0; i < length; i++) source += PIECES[Math.floor(next() * PIECES.length)];
  return source;
}

describe("robustness", () => {
  test("random token soup never throws from parseFormula or evaluateFormulas", () => {
    const next = random(12345);
    for (let i = 0; i < 3_000; i++) {
      const source = randomSource(next);
      expect(() => parseFormula(source)).not.toThrow();
      expect(() =>
        evaluateFormulas({
          measurements: { waist: 700, a: 1 },
          parameters: { b: 2 },
          formulas: { f: source, g: "f + 1" },
        }),
      ).not.toThrow();
    }
  });

  test("every error span lies within the formula source", () => {
    const next = random(777);
    for (let i = 0; i < 3_000; i++) {
      const source = randomSource(next);
      const result = parseFormula(source);
      if (!result.ok) {
        const { start, end } = result.error.span;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThanOrEqual(start);
        expect(end).toBeLessThanOrEqual(source.length);
      }
    }
  });

  test("hostile and deeply nested formulas return errors instead of throwing", () => {
    const result = evaluateFormulas({
      measurements: {},
      parameters: {},
      formulas: { open: "(".repeat(10_000), minus: `${"-".repeat(9_000)}1`, calls: `${"sqrt(".repeat(500)}1` },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.name)).toEqual(["open", "minus", "calls"]);
  });

  test("a large batch of evaluation errors is returned in declaration order", () => {
    // The argument-limit case itself is covered by the `appendAll` test: reaching it end to end
    // needs about a million formulas, which takes seconds.
    const count = 20_000;
    const formulas: Record<string, string> = {};
    for (let i = 0; i < count; i++) formulas[`f${i}`] = "1 / 0";
    const result = evaluateFormulas({ measurements: {}, parameters: {}, formulas });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBe(count);
      expect(result.errors[0]?.name).toBe("f0");
      expect(result.errors[count - 1]?.name).toBe(`f${count - 1}`);
    }
  });

  test("formulas named like prototype members are stored and referenced safely", () => {
    const formulas: Record<string, string> = {};
    Object.defineProperty(formulas, "__proto__", { value: "2 * 3", enumerable: true, configurable: true, writable: true });
    Object.defineProperty(formulas, "constructor", { value: "__proto__ + 1", enumerable: true, configurable: true, writable: true });
    const result = evaluateFormulas({ measurements: {}, parameters: {}, formulas });
    expect(result.ok).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result.values, "__proto__")?.value).toBe(6);
    expect(Object.getOwnPropertyDescriptor(result.values, "constructor")?.value).toBe(7);
  });

  test("evaluateFormulas does not mutate its input", () => {
    const data = { measurements: { m: 2 }, parameters: { p: 3 }, formulas: { a: "b * m", b: "p + 1", c: "c" } };
    const copy = structuredClone(data);
    evaluateFormulas(data);
    expect(data).toEqual(copy);
  });
});

describe("every documented function works end to end", () => {
  test.each([
    ["sqrt(m)", 4],
    ["abs(-m)", 16],
    ["min(m, 3, 5)", 3],
    ["max(m, 3, 5)", 16],
    ["sin(90)", 1],
    ["cos(0)", 1],
    ["tan(0)", 0],
    ["asin(1)", 90],
    ["acos(1)", 0],
    ["atan2(1, 0)", 90],
    ["deg(rad(180))", 180],
  ])("%p", (formula, expected) => {
    const result = evaluateFormulas({ measurements: { m: 16 }, parameters: {}, formulas: { f: formula } });
    expect(result.ok).toBe(true);
    expect(result.values.f).toBeCloseTo(expected, 9);
  });

  test("unary minus, parentheses and precedence through a reference", () => {
    const result = evaluateFormulas({
      measurements: { x: 3 },
      parameters: {},
      formulas: { f: "--x", g: "2 * -x", h: "(1 + 2) * x - 4 / 2" },
    });
    expect(result).toEqual({ ok: true, values: { x: 3, f: 3, g: -6, h: 7 } });
  });

  test("a measurement may share a name with a function when used as a reference", () => {
    const result = evaluateFormulas({ measurements: { deg: 5 }, parameters: {}, formulas: { f: "deg + deg(rad(1))" } });
    expect(result.ok).toBe(true);
    expect(result.values.f).toBeCloseTo(6, 9);
  });
});
