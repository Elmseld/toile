import { describe, expect, test } from "bun:test";
import { compilePattern, evaluatePattern } from "./evaluate";
import type { PatternError, PatternInput, PatternResult, UserOffset } from "./types";

type Json = Record<string, unknown>;

const def = (fields: Json): Json => ({ version: 1, ...fields });
const start = (name: string, x: string | number, y: string | number, extra: Json = {}): Json => ({
  name,
  op: "start",
  x: String(x),
  y: String(y),
  ...extra,
});
const line = (name: string, from: string, to: string): Json => ({ name, type: "line", from, to });
const piece = (name: string, curves: string[], from: string, to: string): Json => ({
  name,
  outline: curves.map((curve) => ({ curve })),
  grainline: { from, to },
});

const NO_INPUT: PatternInput = { measurements: {} };

function errorsOf(result: PatternResult): PatternError[] {
  return result.ok ? [] : result.errors;
}

/**
 * Overwrites every number and string reachable from `value` and appends to every array, the way a
 * careless caller might reuse a result.
 */
function scribble(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    scribble(item, seen);
    if (typeof item === "number") record[key] = 999;
    else if (typeof item === "string") record[key] = "changed";
  }
  if (Array.isArray(value)) value.push("changed");
}

/** `kind:name[:field]` of every error, for compact assertions. */
function summary(result: PatternResult): string[] {
  return errorsOf(result).map((error) => {
    if (!("name" in error)) return error.kind;
    const field = "field" in error && error.field !== undefined ? `:${error.field}` : "";
    return `${error.kind}:${error.name}${field}`;
  });
}

describe("formulas everywhere", () => {
  test("formula fields use measurements, parameters, formulas and geometry functions", () => {
    const result = evaluatePattern(
      def({
        measurements: ["hip"],
        parameters: { ease: 10 },
        formulas: { width: "hip / 4 + ease", diagonal: "distance(A, C)", top: "length(t)" },
        points: [
          start("A", 0, 0),
          { name: "B", op: "along_angle", from: "A", angle: "0", distance: "width" },
          { name: "C", op: "offset", from: "B", dx: "0", dy: "top / 2" },
          { name: "E", op: "along_angle", from: "A", angle: "angle(A, C)", distance: "diagonal * 2" },
        ],
        curves: [line("t", "A", "B")],
      }),
      { measurements: { hip: 1000, other: 5 } },
    );
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({ hip: 1000, ease: 10, width: 260, diagonal: Math.hypot(260, 130), top: 260 });
    expect(result.points.B).toEqual({ x: 260, y: 0 });
    expect(result.points.C).toEqual({ x: 260, y: 130 });
    expect(result.points.E?.x).toBeCloseTo(520, 9);
    expect(result.points.E?.y).toBeCloseTo(260, 9);
    expect(result.curves.t).toEqual({ name: "t", type: "line", from: { x: 0, y: 0 }, to: { x: 260, y: 0 }, length: 260 });
  });

  test("declaration order does not matter", () => {
    const result = evaluatePattern(
      def({
        formulas: { half: "distance(A, B) / 2" },
        points: [
          { name: "C", op: "offset", from: "B", dx: "half", dy: "0" },
          { name: "B", op: "offset", from: "A", dx: "40", dy: "0" },
          start("A", 0, 0),
        ],
      }),
      NO_INPUT,
    );
    expect(result).toMatchObject({ ok: true, values: { half: 20 } });
    expect(Object.keys(result.points)).toEqual(["C", "B", "A"]);
    expect(result.points.C).toEqual({ x: 60, y: 0 });
  });

  test("an evaluation error in a formula field carries the field and a span into it", () => {
    const result = evaluatePattern(
      def({ points: [start("A", "1 / 0", 0)] }),
      NO_INPUT,
    );
    expect(errorsOf(result)).toEqual([
      {
        kind: "division_by_zero",
        span: { start: 4, end: 5 },
        message: expect.any(String),
        name: "A",
        field: "x",
      },
    ]);
  });

  test("a syntax error in a formula field carries the field", () => {
    const result = evaluatePattern(def({ points: [start("A", 0, "1 +")] }), NO_INPUT);
    expect(summary(result)).toEqual(["syntax:A:y"]);
  });
});

describe("measurements and parameters", () => {
  const definition = def({
    measurements: ["waist"],
    parameters: { ease: 10 },
    formulas: { w: "waist + ease" },
    points: [start("A", "w", 0), start("B", 0, 0)],
  });

  test("an override replaces the default", () => {
    const result = evaluatePattern(definition, { measurements: { waist: 700 }, parameters: { ease: 20 } });
    expect(result).toMatchObject({ ok: true, values: { waist: 700, ease: 20, w: 720 } });
  });

  test("an undeclared override is unknown_parameter, reported last, and fails nothing", () => {
    const result = evaluatePattern(definition, {
      measurements: { waist: 700 },
      parameters: { waist: 1, nope: 2 },
    });
    expect(summary(result)).toEqual(["unknown_parameter:waist", "unknown_parameter:nope"]);
    expect(result.values.w).toBe(710);
  });

  test("non-finite defaults, overrides and measurements are invalid_value", () => {
    const result = evaluatePattern(
      { ...definition, parameters: { ease: Number.NaN } },
      { measurements: { waist: Number.POSITIVE_INFINITY } },
    );
    expect(summary(result)).toEqual([
      "invalid_value:waist",
      "invalid_value:ease",
      "failed_dependency:w",
      "failed_dependency:A:x",
    ]);
    const override = evaluatePattern(definition, {
      measurements: { waist: 700 },
      parameters: { ease: "5" as unknown as number },
    });
    expect(summary(override)).toEqual(["invalid_value:ease", "failed_dependency:w", "failed_dependency:A:x"]);
  });

  test("a missing declared measurement fails its dependants; other points still compute", () => {
    const result = evaluatePattern(definition, { measurements: {} });
    expect(summary(result)).toEqual([
      "missing_measurement:waist",
      "failed_dependency:w",
      "failed_dependency:A:x",
    ]);
    expect(result.points).toEqual({ B: { x: 0, y: 0 } });
  });

  test("extra profile measurements are ignored, even one named like a point", () => {
    const result = evaluatePattern(definition, { measurements: { waist: 700, A: 5, B: 1 } });
    expect(result.ok).toBe(true);
  });

  test("a missing or null input counts as empty", () => {
    for (const input of [null, undefined, {}, { measurements: null, parameters: 5 }]) {
      const result = evaluatePattern(definition, input as unknown as PatternInput);
      expect(summary(result)[0]).toBe("missing_measurement:waist");
    }
  });
});

describe("names", () => {
  test("invalid_name", () => {
    const result = evaluatePattern(def({ points: [start("1A", 0, 0)], formulas: { "a-b": "1" } }), NO_INPUT);
    expect(errorsOf(result)).toEqual([
      { kind: "invalid_name", name: "a-b", source: "formula", message: expect.any(String) },
      { kind: "invalid_name", name: "1A", source: "point", message: expect.any(String) },
    ]);
  });

  test("duplicate_name across sources", () => {
    const result = evaluatePattern(
      def({
        measurements: ["c"],
        formulas: { A: "1" },
        points: [start("A", 0, 0), start("B", 0, 0)],
        curves: [line("c", "A", "B")],
      }),
      { measurements: { c: 1 } },
    );
    expect(errorsOf(result)).toEqual([
      { kind: "duplicate_name", name: "c", sources: ["measurement", "curve"], message: expect.any(String) },
      { kind: "duplicate_name", name: "A", sources: ["formula", "point"], message: expect.any(String) },
    ]);
    expect(result.points).toEqual({ B: { x: 0, y: 0 } });
  });

  test("a point that uses a duplicate name fails with failed_dependency", () => {
    const result = evaluatePattern(
      def({ points: [start("A", 0, 0), start("A", 1, 1), { name: "B", op: "midpoint", from: "A", to: "A" }] }),
      NO_INPUT,
    );
    expect(summary(result)).toEqual(["duplicate_name:A", "failed_dependency:B:from"]);
  });
});

describe("references", () => {
  test("unknown_reference in a name field spans the whole name", () => {
    const result = evaluatePattern(
      def({ points: [{ name: "B", op: "offset", from: "Nope", dx: "0", dy: "0" }] }),
      NO_INPUT,
    );
    expect(errorsOf(result)).toEqual([
      {
        kind: "unknown_reference",
        reference: "Nope",
        span: { start: 0, end: 4 },
        message: expect.any(String),
        name: "B",
        field: "from",
      },
    ]);
  });

  test("unknown_reference in a formula field spans into the formula", () => {
    const result = evaluatePattern(
      def({ points: [start("A", 0, 0), { name: "B", op: "offset", from: "A", dx: "1 + zz", dy: "0" }] }),
      NO_INPUT,
    );
    expect(errorsOf(result)).toEqual([
      {
        kind: "unknown_reference",
        reference: "zz",
        span: { start: 4, end: 6 },
        message: expect.any(String),
        name: "B",
        field: "dx",
      },
    ]);
    const formula = evaluatePattern(def({ formulas: { f: "distance(A, Q)" }, points: [start("A", 0, 0)] }), NO_INPUT);
    expect(errorsOf(formula)).toEqual([
      { kind: "unknown_reference", reference: "Q", span: { start: 12, end: 13 }, message: expect.any(String), name: "f" },
    ]);
  });

  test("wrong_reference_kind for a measurement as from", () => {
    const result = evaluatePattern(
      def({ measurements: ["waist"], points: [{ name: "B", op: "offset", from: "waist", dx: "0", dy: "0" }] }),
      { measurements: { waist: 700 } },
    );
    expect(errorsOf(result)).toEqual([
      {
        kind: "wrong_reference_kind",
        name: "B",
        field: "from",
        reference: "waist",
        expected: "point",
        actual: "value",
        span: { start: 0, end: 5 },
        message: expect.any(String),
      },
    ]);
  });

  test("wrong_reference_kind for a point in arithmetic and length() of a point", () => {
    const result = evaluatePattern(
      def({
        formulas: { f: "2 * A", g: "length(A)" },
        points: [start("A", 0, 0)],
      }),
      NO_INPUT,
    );
    expect(errorsOf(result)).toMatchObject([
      { kind: "wrong_reference_kind", name: "f", reference: "A", expected: "value", actual: "point", span: { start: 4, end: 5 } },
      { kind: "wrong_reference_kind", name: "g", reference: "A", expected: "curve", actual: "point", span: { start: 7, end: 8 } },
    ]);
    expect(errorsOf(result).some((error) => "field" in error)).toBe(false);
  });

  test("wrong_reference_kind for a piece name anywhere", () => {
    const result = evaluatePattern(
      def({
        formulas: { f: "p" },
        points: [start("A", 0, 0), { name: "B", op: "offset", from: "p", dx: "0", dy: "0" }],
        curves: [line("c", "A", "A")],
        pieces: [
          piece("p", ["c"], "A", "A"),
          piece("q", ["p"], "A", "A"),
        ],
      }),
      NO_INPUT,
    );
    expect(summary(result)).toEqual([
      "wrong_reference_kind:f",
      "wrong_reference_kind:B:from",
      "wrong_reference_kind:q:outline/0/curve",
    ]);
    expect(Object.keys(result.pieces)).toEqual(["p"]);
  });
});

describe("cycles", () => {
  test("point <-> point", () => {
    const result = evaluatePattern(
      def({
        points: [
          { name: "A", op: "offset", from: "B", dx: "0", dy: "0" },
          { name: "B", op: "offset", from: "A", dx: "0", dy: "0" },
          start("C", 0, 0),
        ],
      }),
      NO_INPUT,
    );
    expect(errorsOf(result)).toEqual([
      {
        kind: "circular_dependency",
        name: "A",
        cycle: ["A", "B", "A"],
        span: { start: 0, end: 1 },
        message: expect.any(String),
        field: "from",
      },
      {
        kind: "failed_dependency",
        name: "B",
        dependency: "A",
        span: { start: 0, end: 1 },
        message: expect.any(String),
        field: "from",
      },
    ]);
    expect(result.points).toEqual({ C: { x: 0, y: 0 } });
  });

  test("point -> formula -> length(curve) -> point", () => {
    const result = evaluatePattern(
      def({
        formulas: { f: "length(c)" },
        points: [start("A", 0, 0), { name: "B", op: "offset", from: "A", dx: "f", dy: "0" }],
        curves: [line("c", "A", "B")],
      }),
      NO_INPUT,
    );
    expect(summary(result)).toEqual([
      "circular_dependency:f",
      "failed_dependency:B:dx",
      "failed_dependency:c:to",
    ]);
    const [cycle] = errorsOf(result);
    expect(cycle).toMatchObject({ cycle: ["f", "c", "B", "f"], span: { start: 7, end: 8 } });
    expect(result.points).toEqual({ A: { x: 0, y: 0 } });
  });

  test("a self reference through distance()", () => {
    const result = evaluatePattern(
      def({ points: [start("A", "distance(A, A)", 0)] }),
      NO_INPUT,
    );
    expect(errorsOf(result)).toMatchObject([
      { kind: "circular_dependency", name: "A", cycle: ["A", "A"], field: "x", span: { start: 9, end: 10 } },
    ]);
  });
});

describe("partial results and pieces", () => {
  const base = {
    points: [
      start("A", 0, 0),
      start("B", 100, 0),
      start("C", 100, 100),
      { name: "X", op: "along_line", from: "A", to: "A", distance: "1" },
    ],
    curves: [
      line("ab", "A", "B"),
      line("bc", "B", "C"),
      line("ca", "C", "A"),
      line("ax", "A", "X"),
      line("xc", "X", "C"),
    ],
  };

  test("a failing point leaves unrelated points, curves and pieces computed", () => {
    const result = evaluatePattern(
      def({ ...base, pieces: [piece("t", ["ab", "bc", "ca"], "A", "C")] }),
      NO_INPUT,
    );
    expect(summary(result)).toEqual([
      "degenerate_geometry:X:to",
      "failed_dependency:ax:to",
      "failed_dependency:xc:from",
    ]);
    expect(Object.keys(result.points)).toEqual(["A", "B", "C"]);
    expect(Object.keys(result.curves)).toEqual(["ab", "bc", "ca"]);
    expect(result.pieces.t?.outline.map((curve) => curve.name)).toEqual(["ab", "bc", "ca"]);
    expect(result.pieces.t?.grainline).toEqual({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
  });

  test("a piece whose curve failed is absent with failed_dependency on that outline entry", () => {
    const result = evaluatePattern(
      def({ ...base, pieces: [piece("t", ["ca", "ax", "xc"], "A", "C")] }),
      NO_INPUT,
    );
    expect(errorsOf(result).at(-1)).toMatchObject({
      kind: "failed_dependency",
      name: "t",
      dependency: "ax",
      field: "outline/1/curve",
    });
    expect(result.pieces).toEqual({});
  });

  test("an open outline is reported even when its curves fail to compute", () => {
    // `ax` fails (X is degenerate), but the outline is open by name whatever the measurements.
    const result = evaluatePattern(
      def({ ...base, pieces: [piece("t", ["ab", "ax"], "A", "C")] }),
      NO_INPUT,
    );
    expect(errorsOf(result).at(-1)).toMatchObject({
      kind: "open_outline",
      name: "t",
      field: "outline/1/curve",
    });
    expect(errorsOf(result).filter((error) => "name" in error && error.name === "t")).toHaveLength(1);
    expect(result.pieces).toEqual({});
  });

  test("an outline that does not close is open_outline on the entry that does not connect", () => {
    const result = evaluatePattern(
      def({ ...base, pieces: [piece("t", ["ab", "ca"], "A", "C")] }),
      NO_INPUT,
    );
    expect(errorsOf(result).at(-1)).toEqual({
      kind: "open_outline",
      name: "t",
      field: "outline/1/curve",
      message: expect.any(String),
    });
    // The wrap-around from the last curve back to the first is checked too.
    const wrap = evaluatePattern(
      def({ ...base, pieces: [piece("t", ["ab", "bc"], "A", "C")] }),
      NO_INPUT,
    );
    expect(errorsOf(wrap).at(-1)).toMatchObject({ kind: "open_outline", field: "outline/0/curve" });
  });

  test("a grainline with an unknown point", () => {
    const result = evaluatePattern(
      def({ ...base, pieces: [piece("t", ["ab", "bc", "ca"], "A", "Z")] }),
      NO_INPUT,
    );
    expect(errorsOf(result).at(-1)).toMatchObject({
      kind: "unknown_reference",
      name: "t",
      field: "grainline/to",
      reference: "Z",
    });
  });

  test("no_intersection and a non-finite position", () => {
    // The formula language has no exponent notation.
    const huge = `1${"0".repeat(200)}`;
    const nearMax = `1${"0".repeat(308)}`;
    const result = evaluatePattern(
      def({
        points: [
          start("A", 0, 0),
          start("B", 10, 0),
          start("C", 0, 5),
          start("D", 10, 5),
          { name: "X", op: "line_intersection", line1: ["A", "B"], line2: ["C", "D"] },
          start("H", `${huge} * ${huge}`, 0),
          { name: "Y", op: "offset", from: "A", dx: nearMax, dy: "0", user_offset: { dx: 1.7e308, dy: 0 } },
        ],
      }),
      NO_INPUT,
    );
    expect(summary(result)).toEqual(["no_intersection:X", "invalid_result:H:x", "degenerate_geometry:Y"]);
  });

  test("a position more than 10 km (1e7 mm) from the origin is degenerate_geometry", () => {
    const result = evaluatePattern(
      def({
        points: [
          start("A", 10_000_000, -10_000_000),
          start("B", 10_000_001, 0),
          start("C", 0, 0, { user_offset: { dx: 0, dy: -1e300 } }),
          // Finite, but far beyond what SVG formatting could round (1e306 * 100 overflows).
          start("D", `1${"0".repeat(306)}`, 0),
          { name: "E", op: "offset", from: "A", dx: "0", dy: "-1" },
        ],
      }),
      NO_INPUT,
    );
    expect(summary(result)).toEqual([
      "degenerate_geometry:B",
      "degenerate_geometry:C",
      "degenerate_geometry:D",
      "degenerate_geometry:E",
    ]);
    expect(result.points).toEqual({ A: { x: 10_000_000, y: -10_000_000 } });
  });
});

describe("user offsets", () => {
  test("dependent points, curves and distance() see the offset position", () => {
    const result = evaluatePattern(
      def({
        formulas: { d: "distance(A, B)" },
        points: [
          start("A", 0, 0, { user_offset: { dx: 3, dy: 4 } }),
          start("B", 10, 0, { user_offset: { dx: 0, dy: 10 } }),
          { name: "C", op: "along_line", from: "A", to: "B", distance: "5" },
        ],
        curves: [line("ab", "A", "B")],
      }),
      NO_INPUT,
    );
    expect(result.ok).toBe(true);
    expect(result.points.A).toEqual({ x: 3, y: 4 });
    expect(result.points.B).toEqual({ x: 10, y: 10 });
    expect(result.values.d).toBeCloseTo(Math.hypot(7, 6), 9);
    expect(result.points.C?.x).toBeCloseTo(3 + (5 * 7) / Math.hypot(7, 6), 9);
    expect(result.points.C?.y).toBeCloseTo(4 + (5 * 6) / Math.hypot(7, 6), 9);
    expect(result.curves.ab).toMatchObject({ from: { x: 3, y: 4 }, to: { x: 10, y: 10 } });
    expect(result.curves.ab?.length).toBeCloseTo(Math.hypot(7, 6), 9);
  });
});

describe("result shape", () => {
  test("errors are sorted by declaration order and ok: true has no errors key", () => {
    const result = evaluatePattern(
      def({
        measurements: ["m"],
        formulas: { f: "zz" },
        points: [{ name: "A", op: "offset", from: "Q", dx: "0", dy: "0" }],
        curves: [line("c", "A", "A")],
      }),
      NO_INPUT,
    );
    expect(summary(result)).toEqual([
      "missing_measurement:m",
      "unknown_reference:f",
      "unknown_reference:A:from",
      "failed_dependency:c:from",
    ]);
    const ok = evaluatePattern(def({ points: [start("A", 0, 0)] }), NO_INPUT);
    expect(ok).toEqual({
      ok: true,
      values: {},
      points: { A: { x: 0, y: 0 } },
      basePoints: { A: { x: 0, y: 0 } },
      curves: {},
      pieces: {},
    });
    expect("errors" in ok).toBe(false);
  });

  test("a structurally invalid definition gives empty records", () => {
    expect(evaluatePattern({ version: 1, points: 5 }, NO_INPUT)).toEqual({
      ok: false,
      values: {},
      points: {},
      basePoints: {},
      curves: {},
      pieces: {},
      errors: [{ kind: "invalid_definition", path: "/points", message: expect.any(String) }],
    });
    expect(evaluatePattern({ version: 3 }, NO_INPUT)).toMatchObject({
      ok: false,
      errors: [{ kind: "unsupported_version", version: 3 }],
    });
  });

  test("does not mutate the definition or the input", () => {
    const definition = def({
      measurements: ["m"],
      points: [start("A", "m", 0, { user_offset: { dx: 1, dy: 1 } })],
    });
    const input = { measurements: { m: 5 } };
    const before = JSON.stringify([definition, input]);
    evaluatePattern(definition, input);
    expect(JSON.stringify([definition, input])).toBe(before);
  });

  test("__proto__, constructor and toString as names work and do not touch prototypes", () => {
    const definition = JSON.parse(
      JSON.stringify({
        version: 1,
        measurements: ["toString"],
        formulas: { constructor: "toString * 2" },
        points: [
          { name: "__proto__", op: "start", x: "constructor", y: "0" },
          { name: "hasOwnProperty", op: "offset", from: "__proto__", dx: "1", dy: "0" },
        ],
        curves: [{ name: "valueOf", type: "line", from: "__proto__", to: "hasOwnProperty" }],
        pieces: [],
      }),
    );
    const result = evaluatePattern(definition, JSON.parse('{"measurements":{"toString":3,"__proto__":9}}'));
    expect(result.ok).toBe(true);
    expect(Object.entries(result.values)).toEqual([
      ["toString", 3],
      ["constructor", 6],
    ]);
    expect(Object.entries(result.points)).toEqual([
      ["__proto__", { x: 6, y: 0 }],
      ["hasOwnProperty", { x: 7, y: 0 }],
    ]);
    expect(Object.getPrototypeOf(result.points)).toBe(Object.prototype);
    expect(Object.keys(result.curves)).toEqual(["valueOf"]);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  test("a name only on the prototype is unknown", () => {
    const result = evaluatePattern(def({ formulas: { f: "toString + 1" } }), NO_INPUT);
    expect(summary(result)).toEqual(["unknown_reference:f"]);
  });
});

describe("compilePattern", () => {
  const definition = def({
    measurements: ["m"],
    parameters: { p: 2 },
    formulas: { f: "m * p", g: "distance(A, B) + length(ab)", c1: "c2", c2: "c1" },
    points: [
      start("A", 0, 0),
      start("B", "f", 0, { user_offset: { dx: 0, dy: 5 } }),
      { name: "C", op: "along_line", from: "A", to: "B", distance: "g / 4" },
    ],
    curves: [line("ab", "A", "B")],
  });
  const inputs: PatternInput[] = [
    { measurements: { m: 10 } },
    { measurements: {} },
    { measurements: { m: 30 }, parameters: { p: 3, stray: 1 } },
    { measurements: { m: Number.NaN } },
  ];
  const FIRST = inputs[0] as PatternInput;

  test("every evaluation equals evaluatePattern, with no state carried between inputs", () => {
    const compiled = compilePattern(definition);
    for (let round = 0; round < 3; round++) {
      for (const input of inputs) {
        expect(compiled.evaluate(input)).toEqual(evaluatePattern(definition, input));
      }
    }
  });

  test("results share no objects with each other", () => {
    const compiled = compilePattern(definition);
    const first = compiled.evaluate(FIRST);
    const expected = compiled.evaluate(FIRST);
    if (first.ok) throw new Error("the cycle c1 <-> c2 must be reported");
    for (const error of first.errors) {
      error.message = "changed";
      if (error.kind === "circular_dependency") error.cycle.push("changed");
    }
    (first.points.B as { x: number }).x = 999;
    (first.values as Record<string, number>).f = 999;
    expect(compiled.evaluate(FIRST)).toEqual(expected);
  });

  test("mutating every object of a result changes no later evaluation", () => {
    // Errors with spans from parsed formulas (invalid_result, unknown_reference), from graph edges
    // (failed_dependency, circular_dependency) and from name fields (failed_dependency of a curve).
    const compiled = compilePattern(
      def({
        measurements: ["w"],
        formulas: { f: "w / 0", g: "w + 1", h: "f + 1", c1: "c2", c2: "c1" },
        points: [
          start("A", "w", "0"),
          start("B", "g", "nope"),
          start("C", "1", "2"),
          start("D", "3", "4"),
          { name: "E", op: "offset", from: "A", dx: "1", dy: "1" },
        ],
        curves: [line("ae", "A", "E"), line("cd", "C", "D"), line("dc", "D", "C")],
        pieces: [piece("p", ["ae"], "A", "E"), piece("q", ["cd", "dc"], "C", "D")],
      }),
    );
    const inputs: PatternInput[] = [{ measurements: {} }, { measurements: { w: 5 } }];
    const expected = inputs.map((input) => compiled.evaluate(input));
    for (const input of inputs) {
      const result = compiled.evaluate(input);
      expect(errorsOf(result).length).toBeGreaterThan(0);
      scribble(result);
    }
    inputs.forEach((input, i) => expect(compiled.evaluate(input)).toEqual(expected[i] as PatternResult));
  });

  test("offsets replace user offsets for one evaluation; null removes one", () => {
    const compiled = compilePattern(definition);
    const moved = compiled.evaluate(FIRST, { offsets: { A: { dx: 1, dy: 2 }, B: null } });
    expect(moved.points.A).toEqual({ x: 1, y: 2 });
    expect(moved.basePoints.A).toEqual({ x: 0, y: 0 });
    expect(moved.points.B).toEqual({ x: 20, y: 0 });
    expect(moved.curves.ab).toMatchObject({ from: { x: 1, y: 2 }, to: { x: 20, y: 0 } });
    const plain = compiled.evaluate(FIRST);
    expect(plain.points.A).toEqual({ x: 0, y: 0 });
    expect(plain.points.B).toEqual({ x: 20, y: 5 });
    expect(plain.basePoints.B).toEqual({ x: 20, y: 0 });
  });

  test("offsets for other names are ignored and malformed ones fail the point", () => {
    const compiled = compilePattern(definition);
    const ignored = compiled.evaluate(FIRST, { offsets: { m: { dx: 1, dy: 1 }, zz: { dx: 1, dy: 1 } } });
    expect(ignored).toEqual(compiled.evaluate(FIRST));
    const malformed = { A: { dx: "1", dy: 0 } } as unknown as Record<string, UserOffset>;
    const result = compiled.evaluate(FIRST, { offsets: malformed });
    expect(summary(result)).toEqual([
      "failed_dependency:g",
      "circular_dependency:c1",
      "failed_dependency:c2",
      "degenerate_geometry:A",
      "failed_dependency:C:from",
      "failed_dependency:ab:from",
    ]);
    expect(result.basePoints.A).toEqual({ x: 0, y: 0 });
    expect(result.points.A).toBeUndefined();
  });

  test("an offset beyond the coordinate bound keeps the base position", () => {
    const compiled = compilePattern(def({ points: [start("A", 3, 4)] }));
    const result = compiled.evaluate(NO_INPUT, { offsets: { A: { dx: 2e7, dy: 0 } } });
    expect(summary(result)).toEqual(["degenerate_geometry:A"]);
    expect(result.points).toEqual({});
    expect(result.basePoints).toEqual({ A: { x: 3, y: 4 } });
  });

  test("a base position beyond the bound fails even when the offset brings it back", () => {
    const definition = def({ points: [start("A", 2e7, 0, { user_offset: { dx: -1.5e7, dy: 0 } })] });
    const compiled = compilePattern(definition);
    for (const result of [
      compiled.evaluate(NO_INPUT),
      compiled.evaluate(NO_INPUT, { offsets: { A: { dx: -2e7, dy: 0 } } }),
    ]) {
      expect(summary(result)).toEqual(["degenerate_geometry:A"]);
      expect(errorsOf(result)[0]?.message).toContain("before the user offset");
      expect(result.points).toEqual({});
      expect(result.basePoints).toEqual({});
    }
  });

  test("every point in points has a base position", () => {
    const result = compilePattern(definition).evaluate(FIRST, { offsets: { C: { dx: 1, dy: 1 } } });
    expect(Object.keys(result.points).length).toBeGreaterThan(0);
    for (const name of Object.keys(result.points)) expect(result.basePoints[name]).toBeDefined();
  });

  test("unreadable options count as none", () => {
    const compiled = compilePattern(definition);
    const hostile = {
      get offsets(): never {
        throw new Error("boom");
      },
    };
    const expected = compiled.evaluate(FIRST);
    for (const options of [hostile, null, 5, { offsets: null }, { offsets: "x" }]) {
      expect(compiled.evaluate(FIRST, options as never)).toEqual(expected);
    }
  });

  test("a structurally invalid definition gives fresh copies of its errors on every evaluation", () => {
    const invalid = { version: 1, points: 5 };
    const compiled = compilePattern(invalid);
    const first = compiled.evaluate(NO_INPUT);
    expect(first).toEqual(evaluatePattern(invalid, NO_INPUT));
    if (first.ok) throw new Error("must not validate");
    (first.errors[0] as { path: string }).path = "changed";
    expect(compiled.evaluate(NO_INPUT)).toEqual(evaluatePattern(invalid, NO_INPUT));
  });

  test("the definition is not read after compiling", () => {
    const raw = def({ points: [start("A", 1, 2)] });
    const compiled = compilePattern(raw);
    (raw.points as Json[]).push(start("B", 3, 4));
    expect(compiled.evaluate(NO_INPUT).points).toEqual({ A: { x: 1, y: 2 } });
  });
});
