import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DefinitionError } from "./types";
import { PATTERN_FORMAT_VERSION, validateDefinition } from "./validate";

const EXAMPLE_PATH = join(import.meta.dir, "..", "..", "examples", "rectangle-with-dart.json");
const example = (): Record<string, unknown> => JSON.parse(readFileSync(EXAMPLE_PATH, "utf8"));

function errorsOf(value: unknown): DefinitionError[] {
  const result = validateDefinition(value);
  return result.ok ? [] : result.errors;
}

function pathsOf(value: unknown): string[] {
  return errorsOf(value).map((error) => (error.kind === "invalid_definition" ? error.path : "?"));
}

const minimal = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  ...extra,
});

const startPoint = { name: "A", op: "start", x: "0", y: "0" };

describe("validateDefinition", () => {
  test("the example validates and normalises to an equal copy", () => {
    const raw = example();
    const result = validateDefinition(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition).toEqual(raw as never);
    expect(result.definition).not.toBe(raw);
    expect(result.definition.points).not.toBe(raw.points);
    expect(result.definition.points[0]).not.toBe((raw.points as unknown[])[0]);
    expect(PATTERN_FORMAT_VERSION).toBe(1);
  });

  test("missing collections get empty defaults", () => {
    expect(validateDefinition({ version: 1 })).toEqual({
      ok: true,
      definition: {
        version: 1,
        measurements: [],
        parameters: {},
        formulas: {},
        points: [],
        curves: [],
        pieces: [],
      },
    });
  });

  test("a root that is not an object is invalid_definition at the root", () => {
    for (const value of [null, undefined, 1, "x", true, [], [{ version: 1 }]]) {
      expect(errorsOf(value)).toEqual([
        { kind: "invalid_definition", path: "", message: expect.any(String) },
      ]);
    }
  });

  test("a missing or non-numeric version is invalid_definition at /version", () => {
    expect(pathsOf({})).toEqual(["/version"]);
    expect(pathsOf({ version: "1" })).toEqual(["/version"]);
    expect(pathsOf({ version: null })).toEqual(["/version"]);
  });

  test("any other version number is unsupported_version and nothing else is checked", () => {
    expect(errorsOf({ version: 2, bogus: true, points: 5 })).toEqual([
      { kind: "unsupported_version", path: "/version", version: 2, message: expect.any(String) },
    ]);
    expect(errorsOf({ version: 0 })[0]?.kind).toBe("unsupported_version");
    expect(errorsOf({ version: 1.5 })[0]?.kind).toBe("unsupported_version");
  });

  test("unknown fields are rejected at their path, escaped as JSON pointers", () => {
    expect(pathsOf(minimal({ extra: 1 }))).toEqual(["/extra"]);
    expect(pathsOf(minimal({ "a/b~c": 1 }))).toEqual(["/a~1b~0c"]);
    const raw = example();
    const points = raw.points as Record<string, unknown>[];
    const fourth = points[3] as Record<string, unknown>;
    fourth.distnce = "1";
    expect(pathsOf(raw)).toEqual(["/points/3/distnce"]);
  });

  test("unknown op and type", () => {
    expect(pathsOf(minimal({ points: [{ name: "A", op: "teleport", x: "0" }] }))).toEqual([
      "/points/0/op",
    ]);
    expect(pathsOf(minimal({ points: [{ name: "A", op: "__proto__" }] }))).toEqual(["/points/0/op"]);
    expect(pathsOf(minimal({ curves: [{ name: "c", type: "arc", from: "A", to: "B" }] }))).toEqual([
      "/curves/0/type",
    ]);
  });

  test("formula fields must be strings, name fields must be strings", () => {
    expect(
      pathsOf(minimal({ points: [{ name: "A", op: "start", x: 0, y: "0" }] })),
    ).toEqual(["/points/0/x"]);
    expect(
      pathsOf(minimal({ points: [{ name: 1, op: "midpoint", from: "B", to: null }] })),
    ).toEqual(["/points/0/name", "/points/0/to"]);
    expect(pathsOf(minimal({ formulas: { width: 50 } }))).toEqual(["/formulas/width"]);
    expect(pathsOf(minimal({ parameters: { ease: "10" } }))).toEqual(["/parameters/ease"]);
    expect(pathsOf(minimal({ measurements: ["waist", 3] }))).toEqual(["/measurements/1"]);
  });

  test("missing required fields", () => {
    expect(pathsOf(minimal({ points: [{ op: "start", x: "0" }] }))).toEqual([
      "/points/0/name",
      "/points/0/y",
    ]);
    expect(pathsOf(minimal({ points: [{ name: "A" }] }))).toEqual(["/points/0/op"]);
  });

  test("line fields must hold exactly two point names", () => {
    const point = (line1: unknown): Record<string, unknown> =>
      minimal({ points: [{ name: "X", op: "line_intersection", line1, line2: ["C", "D"] }] });
    expect(pathsOf(point(["A"]))).toEqual(["/points/0/line1"]);
    expect(pathsOf(point(["A", "B", "C"]))).toEqual(["/points/0/line1"]);
    expect(pathsOf(point("AB"))).toEqual(["/points/0/line1"]);
    expect(pathsOf(point(["A", 2]))).toEqual(["/points/0/line1/1"]);
    expect(validateDefinition(point(["A", "B"])).ok).toBe(true);
  });

  test("which must be first or second", () => {
    const point = (which: unknown): Record<string, unknown> =>
      minimal({
        points: [
          {
            name: "X",
            op: "line_circle_intersection",
            line: ["A", "B"],
            center: "C",
            radius: "10",
            which,
          },
        ],
      });
    expect(validateDefinition(point("first")).ok).toBe(true);
    expect(validateDefinition(point("second")).ok).toBe(true);
    expect(pathsOf(point("third"))).toEqual(["/points/0/which"]);
    expect(pathsOf(point(1))).toEqual(["/points/0/which"]);
  });

  test("user_offset needs finite dx and dy and nothing else", () => {
    const point = (user_offset: unknown): Record<string, unknown> =>
      minimal({ points: [{ ...startPoint, user_offset }] });
    expect(validateDefinition(point({ dx: 1.5, dy: -2 })).ok).toBe(true);
    expect(pathsOf(point({ dy: 0 }))).toEqual(["/points/0/user_offset/dx"]);
    expect(pathsOf(point({ dx: "1", dy: 0 }))).toEqual(["/points/0/user_offset/dx"]);
    expect(pathsOf(point({ dx: Number.POSITIVE_INFINITY, dy: 0 }))).toEqual([
      "/points/0/user_offset/dx",
    ]);
    expect(pathsOf(point({ dx: Number.NaN, dy: 0 }))).toEqual(["/points/0/user_offset/dx"]);
    expect(pathsOf(point({ dx: 0, dy: 0, dz: 0 }))).toEqual(["/points/0/user_offset/dz"]);
    expect(pathsOf(point(null))).toEqual(["/points/0/user_offset"]);
  });

  test("outline must be a non-empty list of { curve } entries; grainline needs from and to", () => {
    const piece = (fields: Record<string, unknown>): Record<string, unknown> =>
      minimal({
        pieces: [{ name: "p", outline: [{ curve: "a" }], grainline: { from: "A", to: "B" }, ...fields }],
      });
    expect(validateDefinition(piece({})).ok).toBe(true);
    expect(pathsOf(piece({ outline: [] }))).toEqual(["/pieces/0/outline"]);
    expect(pathsOf(piece({ outline: [{ curve: "a" }, 1] }))).toEqual(["/pieces/0/outline/1"]);
    expect(pathsOf(piece({ outline: ["a"] }))).toEqual(["/pieces/0/outline/0"]);
    expect(pathsOf(piece({ outline: [{ curve: "a" }, { curve: 1 }] }))).toEqual(["/pieces/0/outline/1/curve"]);
    expect(pathsOf(piece({ outline: [{}] }))).toEqual(["/pieces/0/outline/0/curve"]);
    expect(pathsOf(piece({ outline: [{ curve: "a", reversed: true }] }))).toEqual([
      "/pieces/0/outline/0/reversed",
    ]);
    expect(pathsOf(piece({ outline: "a" }))).toEqual(["/pieces/0/outline"]);
    expect(pathsOf(piece({ grainline: { from: "A" } }))).toEqual(["/pieces/0/grainline/to"]);
    expect(pathsOf(piece({ grainline: ["A", "B"] }))).toEqual(["/pieces/0/grainline"]);
    expect(pathsOf(piece({ grainline: { from: "A", to: "B", via: "C" } }))).toEqual([
      "/pieces/0/grainline/via",
    ]);
  });

  test("collections of the wrong type", () => {
    expect(
      pathsOf(
        minimal({ measurements: {}, parameters: [], formulas: "x", points: {}, curves: 1, pieces: null }),
      ),
    ).toEqual(["/measurements", "/parameters", "/formulas", "/points", "/curves", "/pieces"]);
    expect(pathsOf(minimal({ name: 1, source: null }))).toEqual(["/name", "/source"]);
    expect(pathsOf(minimal({ points: [null, 1, [], "A"] }))).toEqual([
      "/points/0",
      "/points/1",
      "/points/2",
      "/points/3",
    ]);
  });

  test("several problems are reported together", () => {
    const errors = errorsOf({
      extra: true,
      points: [{ name: "A", op: "start", x: 0, y: "0" }],
      curves: [{ name: "c", type: "line", from: "A" }],
    });
    expect(errors.map((e) => (e.kind === "invalid_definition" ? e.path : e.kind))).toEqual([
      "/version",
      "/extra",
      "/points/0/x",
      "/curves/0/to",
    ]);
  });

  test("does not mutate the input", () => {
    const raw = example();
    const before = JSON.stringify(raw);
    const result = validateDefinition(raw);
    expect(JSON.stringify(raw)).toBe(before);
    if (result.ok) {
      result.definition.points.pop();
      expect(JSON.stringify(raw)).toBe(before);
    }
  });

  test("names such as __proto__ in records stay own data", () => {
    const raw = JSON.parse('{"version":1,"parameters":{"__proto__":5},"formulas":{"constructor":"1"}}');
    const result = validateDefinition(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.hasOwn(result.definition.parameters, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result.definition.parameters)).toBe(Object.prototype);
    expect(Object.entries(result.definition.formulas)).toEqual([["constructor", "1"]]);
  });

  test("never throws for odd input", () => {
    const sparse: unknown[] = [];
    sparse.length = 4_000_000_000;
    const hostile = {
      version: 1,
      get points(): unknown {
        throw new Error("boom");
      },
    };
    const values: unknown[] = [
      null,
      undefined,
      0,
      "",
      [],
      { version: 1, points: [null], curves: [undefined], pieces: [{ outline: null }, { outline: [null, [], { curve: null }] }] },
      { version: 1, points: sparse },
      { version: 1, points: [, startPoint] },
      { version: 1, measurements: null, parameters: null, formulas: null },
      hostile,
      new Proxy({}, { ownKeys: () => { throw new Error("boom"); } }),
    ];
    for (const value of values) {
      expect(() => validateDefinition(value)).not.toThrow();
      expect(validateDefinition(value).ok).toBe(false);
    }
    expect(pathsOf({ version: 1, points: sparse })).toEqual(["/points"]);
    expect(pathsOf({ version: 1, points: [, startPoint] })).toEqual(["/points"]);
  });
});
