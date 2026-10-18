import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluatePattern } from "./evaluate";
import { piecePathData } from "./svg";
import type { PatternResult } from "./types";
import { validateDefinition } from "./validate";
import type { Point } from "./vector";

const EXAMPLE_PATH = join(import.meta.dir, "..", "..", "examples", "rectangle-with-dart.json");

/** The example as raw parsed JSON, read fresh for every test so a test can modify its copy. */
function example(): { points: { name: string; user_offset?: unknown }[] } & Record<string, unknown> {
  return JSON.parse(readFileSync(EXAMPLE_PATH, "utf8"));
}

type Expected = {
  measurements: Record<string, number>;
  width: number;
  dartIntake: number;
  points: Record<string, [number, number]>;
  waistSeam: number;
  sideLength: number;
  dartLeg: number;
  path: string;
};

const SET_1: Expected = {
  measurements: { waist: 680, hip: 940, waist_to_hip: 200 },
  width: 245,
  dartIntake: 65,
  points: {
    A: [0, 0],
    B: [245, 0],
    C: [0, 200],
    D: [245, 200],
    M: [122.5, 0],
    L: [90, 0],
    R: [155, 0],
    P: [122.5, 90],
    K1: [245, 200 / 3],
    K2: [245, 400 / 3],
    G1: [122.5, 110],
    G2: [122.5, 180],
  },
  waistSeam: 180,
  sideLength: 200,
  dartLeg: Math.sqrt(9156.25),
  path: "M 0 0 L 90 0 L 122.5 90 L 155 0 L 245 0 C 245 66.67 245 133.33 245 200 L 0 200 L 0 0 Z",
};

const SET_2: Expected = {
  measurements: { waist: 800, hip: 1080, waist_to_hip: 210 },
  width: 280,
  dartIntake: 70,
  points: {
    A: [0, 0],
    B: [280, 0],
    C: [0, 210],
    D: [280, 210],
    M: [140, 0],
    L: [105, 0],
    R: [175, 0],
    P: [140, 90],
    K1: [280, 70],
    K2: [280, 140],
    G1: [140, 110],
    G2: [140, 190],
  },
  waistSeam: 210,
  sideLength: 210,
  dartLeg: Math.sqrt(9325),
  path: "M 0 0 L 105 0 L 140 90 L 175 0 L 280 0 C 280 70 280 140 280 210 L 0 210 L 0 0 Z",
};

function expectPoint(actual: Point | undefined, [x, y]: [number, number]): void {
  expect(actual).toBeDefined();
  expect(actual?.x).toBeCloseTo(x, 6);
  expect(actual?.y).toBeCloseTo(y, 6);
}

function expectSet(result: PatternResult, expected: Expected): void {
  expect(result.ok).toBe(true);
  expect(result.values.width).toBeCloseTo(expected.width, 6);
  expect(result.values.dart_intake).toBeCloseTo(expected.dartIntake, 6);
  expect(Object.keys(result.points)).toEqual(Object.keys(expected.points));
  for (const [name, coordinates] of Object.entries(expected.points)) {
    expectPoint(result.points[name], coordinates);
  }
  expect(result.values.waist_seam).toBeCloseTo(expected.waistSeam, 6);
  expect(Math.abs((result.values.side_length ?? Number.NaN) - expected.sideLength)).toBeLessThan(1e-9);
  expect(Math.abs((result.curves.side?.length ?? Number.NaN) - expected.sideLength)).toBeLessThan(1e-9);
  expect(result.values.dart_leg).toBeCloseTo(expected.dartLeg, 6);

  const front = result.pieces.front;
  expect(front).toBeDefined();
  if (front === undefined) return;
  expect(front.outline.map((curve) => curve.name)).toEqual([
    "waist_left",
    "dart_left",
    "dart_right",
    "waist_right",
    "side",
    "hem",
    "center",
  ]);
  expectPoint(front.grainline.from, expected.points.G1 ?? [Number.NaN, Number.NaN]);
  expectPoint(front.grainline.to, expected.points.G2 ?? [Number.NaN, Number.NaN]);
  expect(piecePathData(front)).toBe(expected.path);
}

describe("example: rectangle with a dart", () => {
  test("the raw JSON validates", () => {
    expect(validateDefinition(example()).ok).toBe(true);
  });

  test("measurement set 1", () => {
    expectSet(evaluatePattern(example(), { measurements: SET_1.measurements }), SET_1);
  });

  test("measurement set 2", () => {
    expectSet(evaluatePattern(example(), { measurements: SET_2.measurements }), SET_2);
  });

  test("parameter defaults can be overridden", () => {
    const result = evaluatePattern(example(), {
      measurements: SET_1.measurements,
      parameters: { ease_hip: 20 },
    });
    expect(result.values.width).toBe(255);
    expectPoint(result.points.B, [255, 0]);
  });

  test("a user offset on P moves P and everything that depends on it", () => {
    const definition = example();
    const p = definition.points.find((point) => point.name === "P");
    if (p === undefined) throw new Error("P is missing from the example");
    p.user_offset = { dx: 5, dy: 10 };

    const result = evaluatePattern(definition, { measurements: SET_1.measurements });
    expect(result.ok).toBe(true);
    const moved: Record<string, [number, number]> = {
      P: [127.5, 100],
      G1: [127.5, 120],
      G2: [127.5, 190],
    };
    for (const [name, coordinates] of Object.entries(SET_1.points)) {
      expectPoint(result.points[name], moved[name] ?? coordinates);
    }
    expectPoint(result.curves.dart_left?.to, [127.5, 100]);
    expectPoint(result.curves.dart_right?.from, [127.5, 100]);
    expect(result.values.dart_leg).toBeCloseTo(Math.hypot(127.5 - 90, 100), 6);
    const front = result.pieces.front;
    expect(front).toBeDefined();
    if (front !== undefined) {
      expect(piecePathData(front)).toContain("L 127.5 100");
      expectPoint(front.grainline.from, [127.5, 120]);
    }
  });
});
