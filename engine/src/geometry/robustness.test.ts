import { describe, expect, test } from "bun:test";
import { compilePattern, evaluatePattern } from "./evaluate";
import type { PatternError, PatternInput } from "./types";
import { validateDefinition } from "./validate";

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

const NAMES = ["A", "B", "C", "c", "p", "w", "m", "__proto__", "constructor", "1x", "", "a-b"];
const FORMULAS = [
  "0",
  "10",
  "w * 2",
  "distance(A, B)",
  "angle(A, B)",
  "length(c)",
  "A + 1",
  "length(A)",
  "1 / 0",
  "(",
  "m",
  "distance(A, 1)",
  "sqrt(-1)",
];
const GOOD_FORMULAS = ["0", "10", "-5", "w * 2", "m / 10", "f + 1", "25.5"];
const OPS = [
  "start",
  "offset",
  "along_line",
  "along_angle",
  "perpendicular",
  "line_intersection",
  "line_circle_intersection",
  "midpoint",
  "teleport",
];
const FIELDS = [
  "x",
  "y",
  "from",
  "to",
  "dx",
  "dy",
  "distance",
  "angle",
  "line1",
  "line2",
  "line",
  "center",
  "radius",
  "which",
  "user_offset",
];

function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length)] as T;
}

/** A random JSON-ish value, weighted toward plausible ones. */
function value(next: () => number): unknown {
  const roll = next();
  if (roll < 0.35) return pick(next, NAMES);
  if (roll < 0.6) return pick(next, FORMULAS);
  if (roll < 0.7) return [pick(next, NAMES), pick(next, NAMES)];
  if (roll < 0.75) return pick(next, ["first", "second"]);
  if (roll < 0.8) return { dx: next() * 10, dy: pick(next, [0, 1, Number.NaN, "1"]) };
  if (roll < 0.85) return null;
  if (roll < 0.9) return Math.floor(next() * 100);
  if (roll < 0.95) return [[pick(next, NAMES)], {}];
  return undefined;
}

function randomPoint(next: () => number): Record<string, unknown> {
  const point: Record<string, unknown> = { name: pick(next, NAMES), op: pick(next, OPS) };
  const count = Math.floor(next() * 6);
  for (let i = 0; i < count; i++) point[pick(next, FIELDS)] = value(next);
  return point;
}

function randomDefinition(next: () => number): unknown {
  if (next() < 0.05) return value(next);
  const points = Array.from({ length: Math.floor(next() * 8) }, () => randomPoint(next));
  const curves = Array.from({ length: Math.floor(next() * 3) }, () => ({
    name: pick(next, NAMES),
    type: pick(next, ["line", "cubic", "arc"]),
    from: value(next),
    c1: value(next),
    c2: value(next),
    to: value(next),
  }));
  const pieces = Array.from({ length: Math.floor(next() * 2) }, () => ({
    name: pick(next, NAMES),
    outline: [
      { curve: pick(next, NAMES) },
      next() < 0.8 ? { curve: pick(next, NAMES) } : pick(next, NAMES),
      next() < 0.5 ? { curve: value(next) } : value(next),
    ],
    grainline: { from: value(next), to: value(next) },
  }));
  return {
    version: next() < 0.95 ? 1 : value(next),
    measurements: next() < 0.9 ? ["m"] : value(next),
    parameters: next() < 0.9 ? { w: 3 } : value(next),
    formulas: { [pick(next, NAMES)]: pick(next, FORMULAS) },
    points,
    curves,
    pieces,
  };
}

/** Rewrites point definitions so most are well-formed and the evaluator gets past validation. */
function wellFormedDefinition(next: () => number): unknown {
  const names = ["A", "B", "C", "D", "E"];
  // Mostly earlier points and formulas that evaluate, so many points get computed; sometimes
  // anything, for cycles and errors.
  let earlier = names.slice(0, 1);
  const pointName = () => pick(next, next() < 0.9 ? earlier : names);
  const formula = () => pick(next, next() < 0.85 ? GOOD_FORMULAS : FORMULAS);
  const points = names.map((name, i) => {
    earlier = names.slice(0, Math.max(i, 1));
    switch (i === 0 ? "start" : pick(next, OPS.slice(0, 8))) {
      case "start":
        return { name, op: "start", x: formula(), y: formula() };
      case "offset":
        return { name, op: "offset", from: pointName(), dx: formula(), dy: formula() };
      case "along_line":
        return { name, op: "along_line", from: pointName(), to: pointName(), distance: formula() };
      case "along_angle":
        return { name, op: "along_angle", from: pointName(), angle: formula(), distance: formula() };
      case "perpendicular":
        return { name, op: "perpendicular", from: pointName(), to: pointName(), distance: formula() };
      case "line_intersection":
        return { name, op: "line_intersection", line1: [pointName(), pointName()], line2: [pointName(), pointName()] };
      case "line_circle_intersection":
        return {
          name,
          op: "line_circle_intersection",
          line: [pointName(), pointName()],
          center: pointName(),
          radius: formula(),
          which: pick(next, ["first", "second"]),
        };
      default:
        return { name, op: "midpoint", from: pointName(), to: pointName() };
    }
  });
  return {
    version: 1,
    measurements: ["m"],
    parameters: { w: 3 },
    formulas: { f: formula() },
    points,
    curves: [{ name: "c", type: "line", from: pointName(), to: pointName() }],
    pieces: [{ name: "p", outline: [{ curve: "c" }], grainline: { from: pointName(), to: pointName() } }],
  };
}

function expectWellFormedErrors(errors: PatternError[]): void {
  for (const error of errors) {
    expect(typeof error.kind).toBe("string");
    expect(typeof error.message).toBe("string");
    expect("name" in error || "path" in error).toBe(true);
  }
}

const INPUT: PatternInput = { measurements: { m: 700 } };

describe("robustness", () => {
  test("random definitions never make validateDefinition or evaluatePattern throw", () => {
    const next = random(4242);
    for (let i = 0; i < 3_000; i++) {
      const definition = randomDefinition(next);
      expect(() => validateDefinition(definition)).not.toThrow();
      let result: ReturnType<typeof evaluatePattern> | undefined;
      expect(() => {
        result = evaluatePattern(definition, INPUT);
      }).not.toThrow();
      if (result !== undefined && !result.ok) expectWellFormedErrors(result.errors);
    }
  });

  test("random well-formed definitions evaluate without throwing", () => {
    const next = random(99);
    let computedPoints = 0;
    for (let i = 0; i < 3_000; i++) {
      const definition = wellFormedDefinition(next);
      expect(validateDefinition(definition).ok).toBe(true);
      const result = evaluatePattern(definition, INPUT);
      if (!result.ok) expectWellFormedErrors(result.errors);
      for (const point of Object.values(result.points)) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
        computedPoints++;
      }
    }
    // Many points do compute, so the operations themselves are exercised, not just the checks.
    expect(computedPoints).toBeGreaterThan(1_000);
  });

  test("a compiled definition evaluated against alternating inputs matches fresh evaluations", () => {
    const next = random(7);
    const inputs: PatternInput[] = [
      INPUT,
      { measurements: {} },
      { measurements: { m: -40 }, parameters: { w: 0.5 } },
      { measurements: { m: Number.NaN }, parameters: { w: 7, stray: 1 } },
    ];
    for (let i = 0; i < 500; i++) {
      const definition = next() < 0.8 ? wellFormedDefinition(next) : randomDefinition(next);
      const compiled = compilePattern(definition);
      for (let round = 0; round < 2; round++) {
        for (const input of inputs) {
          expect(compiled.evaluate(input)).toEqual(evaluatePattern(definition, input));
        }
      }
    }
  });

  test("random imports and notches never make validation or evaluation throw", () => {
    const next = random(2024);
    const notchValue = (): unknown => {
      const roll = next();
      if (roll < 0.6) {
        const notch: Record<string, unknown> = {
          curve: pick(next, ["c", "d", "e", ...NAMES]),
          distance: pick(next, [...FORMULAS, "-1", "1000000", "length(c) / 2", "w"]),
        };
        if (next() < 0.4) notch.marks = pick(next, [1, 2, 0, 3, 1.5, "2", null]);
        if (next() < 0.1) notch.extra = value(next);
        return notch;
      }
      return value(next);
    };
    for (let i = 0; i < 2_000; i++) {
      const base = wellFormedDefinition(next) as Record<string, unknown>;
      const pieces = base.pieces as Record<string, unknown>[];
      const definition = {
        ...base,
        curves: [
          ...(base.curves as unknown[]),
          { name: "d", type: "line", from: "B", to: "C" },
          { name: "e", type: "cubic", from: "C", c1: "D", c2: "E", to: "A" },
        ],
        imports:
          next() < 0.8
            ? { [pick(next, NAMES)]: pick(next, ["bodice.armhole", "p.v", "x", "a.b.c", 5]) }
            : value(next),
        pieces: [
          {
            ...pieces[0],
            outline: [{ curve: "c" }, { curve: "d" }, { curve: "e" }],
            notches: next() < 0.9 ? Array.from({ length: Math.floor(next() * 4) }, notchValue) : value(next),
          },
        ],
      };
      const inputs: unknown[] = [
        INPUT,
        { measurements: { m: 700 }, imports: { armhole: 400, A: Number.NaN, __proto__: 1 } },
        { measurements: { m: 700 }, imports: value(next) },
      ];
      expect(() => validateDefinition(definition)).not.toThrow();
      for (const input of inputs) {
        let result: ReturnType<typeof evaluatePattern> | undefined;
        expect(() => {
          result = evaluatePattern(definition, input as PatternInput);
        }).not.toThrow();
        if (result !== undefined && !result.ok) expectWellFormedErrors(result.errors);
        for (const computed of Object.values(result?.pieces ?? {})) {
          for (const notch of computed.notches) {
            for (const mark of notch.marks) {
              expect(Number.isFinite(mark.to.x) && Number.isFinite(mark.to.y)).toBe(true);
            }
          }
        }
      }
    }
  });

  test("hostile inputs return errors instead of throwing", () => {
    const hostileInput = {
      get measurements(): never {
        throw new Error("boom");
      },
    };
    const definition = { version: 1, measurements: ["m"] };
    expect(() => evaluatePattern(definition, hostileInput as unknown as PatternInput)).not.toThrow();
    expect(evaluatePattern(definition, hostileInput as unknown as PatternInput)).toMatchObject({
      ok: false,
      errors: [{ kind: "missing_measurement", name: "m" }],
    });
    for (const garbage of [null, undefined, 0, "x", [], [1, 2], { version: 1, points: [[]] }]) {
      expect(() => evaluatePattern(garbage, INPUT)).not.toThrow();
      expect(() => evaluatePattern({ version: 1 }, garbage as unknown as PatternInput)).not.toThrow();
    }
  });

  test("a chain of 10 000 along_line points evaluates without a stack overflow", () => {
    const count = 10_000;
    const points: unknown[] = [
      { name: "P0", op: "start", x: "0", y: "0" },
      { name: "Q", op: "start", x: "1000000", y: "0" },
    ];
    for (let i = 1; i < count; i++) {
      points.push({ name: `P${i}`, op: "along_line", from: `P${i - 1}`, to: "Q", distance: "1" });
    }
    const result = evaluatePattern({ version: 1, points }, INPUT);
    expect(result.ok).toBe(true);
    expect(result.points[`P${count - 1}`]?.x).toBeCloseTo(count - 1, 6);
  });

  test("a 10 000-point cycle evaluates without a stack overflow", () => {
    const count = 10_000;
    const points: unknown[] = [];
    for (let i = 0; i < count; i++) {
      points.push({ name: `P${i}`, op: "offset", from: `P${(i + 1) % count}`, dx: "1", dy: "0" });
    }
    const result = evaluatePattern({ version: 1, points }, INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(count);
    expect(result.errors[0]).toMatchObject({ kind: "circular_dependency", name: "P0", field: "from" });
    expect(result.errors[1]).toMatchObject({ kind: "failed_dependency", name: "P1", field: "from" });
  });
});
