// Tests of the block definitions in engine/blocks/ (ADR 0006). The engine has no block registry,
// so the files are read here with fs; the Phoenix app reads them at compile time.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compilePattern, distance, evaluatePattern, validateDefinition } from "./geometry";
import type { ComputedPattern, ComputedPiece, PatternResult } from "./geometry";
import { isMeasurementKey, MEASUREMENT_KEYS } from "./measurements";

const BLOCKS_DIR = join(import.meta.dir, "..", "blocks");
const SKIRT_PATH = join(BLOCKS_DIR, "straight_skirt.json");

type Measurements = Record<string, number>;

/** Aldrich size 12. */
const SET_A: Measurements = { waist: 680, hip: 940, hip_height: 206, skirt_length: 600 };
const SET_B: Measurements = { waist: 840, hip: 1080, hip_height: 220, skirt_length: 700 };

const DEFAULTS = { ease_waist: 10, ease_hip: 40, length_adjustment: 0 };

/** A plausible value for every catalogue key, so any block file can evaluate against it. */
const FULL_PROFILE: Measurements = {
  bust: 880,
  waist: 680,
  hip: 940,
  neck: 370,
  shoulder_width: 122,
  back_width: 344,
  chest_width: 324,
  back_length: 410,
  armhole_depth: 210,
  front_length: 445,
  bust_height: 265,
  bust_distance: 190,
  hip_height: 206,
  skirt_length: 600,
  arm_length: 580,
  upper_arm: 280,
  wrist: 160,
  height: 1650,
};

function blockFiles(): string[] {
  return readdirSync(BLOCKS_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort();
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function skirtText(): string {
  return readFileSync(SKIRT_PATH, "utf8");
}

function skirt(): Record<string, unknown> {
  return JSON.parse(skirtText());
}

function curveLength(result: ComputedPattern, name: string): number {
  const curve = result.curves[name];
  if (curve === undefined) throw new Error(`curve ${name} did not compute`);
  return curve.length;
}

function point(result: ComputedPattern, name: string): { x: number; y: number } {
  const value = result.points[name];
  if (value === undefined) throw new Error(`point ${name} did not compute`);
  return value;
}

function between(result: ComputedPattern, a: string, b: string): number {
  return distance(point(result, a), point(result, b));
}

function piece(result: ComputedPattern, name: string): ComputedPiece {
  const value = result.pieces[name];
  if (value === undefined) throw new Error(`piece ${name} did not compute`);
  return value;
}

/** Every x of a piece's outline end and control points. */
function outlineXs(value: ComputedPiece): number[] {
  return value.outline.flatMap((curve) =>
    curve.type === "cubic"
      ? [curve.from.x, curve.c1.x, curve.c2.x, curve.to.x]
      : [curve.from.x, curve.to.x],
  );
}

function waistSeams(result: ComputedPattern): number {
  return (
    curveLength(result, "b_waist_cb_seg") +
    curveLength(result, "b_waist_side_seg") +
    curveLength(result, "f_waist_side_seg") +
    curveLength(result, "f_waist_cf_seg")
  );
}

function hipWidths(result: ComputedPattern): number {
  return between(result, "b_hip_cb", "b_hip_side") + between(result, "f_hip_side", "f_hip_cf");
}

function expectWithin(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
}

function expectOk(result: PatternResult): ComputedPattern {
  if (!result.ok) throw new Error(`evaluation failed: ${JSON.stringify(result.errors)}`);
  return result;
}

describe("every block file", () => {
  test("there is at least the straight skirt", () => {
    expect(blockFiles()).toContain("straight_skirt.json");
  });

  test("the full profile has a value for every catalogue key", () => {
    expect(Object.keys(FULL_PROFILE).sort()).toEqual([...MEASUREMENT_KEYS].sort());
  });

  for (const file of blockFiles()) {
    test(`${file} has a valid key, validates and evaluates against the full profile`, () => {
      expect(file).toMatch(/^[a-z][a-z0-9_]*\.json$/);
      const definition = readJson(join(BLOCKS_DIR, file));
      expect(validateDefinition(definition).ok).toBe(true);
      expectOk(evaluatePattern(definition, { measurements: FULL_PROFILE }));
    });

    test(`${file} declares only catalogue measurement keys`, () => {
      const { measurements } = readJson(join(BLOCKS_DIR, file)) as { measurements: unknown };
      expect(Array.isArray(measurements)).toBe(true);
      for (const key of measurements as unknown[]) {
        expect(typeof key === "string" && isMeasurementKey(key)).toBe(true);
      }
    });
  }
});

describe("straight skirt: definition", () => {
  test("names the block and its drafting source", () => {
    const definition = skirt();
    expect(definition.version).toBe(1);
    expect(definition.name).toBe("Straight skirt");
    expect(typeof definition.source).toBe("string");
    expect(String(definition.source)).toContain("Aldrich");
  });

  test("declares exactly the four catalogue measurements", () => {
    const measurements = skirt().measurements as string[];
    expect(measurements).toEqual(["waist", "hip", "hip_height", "skirt_length"]);
    for (const key of measurements) expect(isMeasurementKey(key)).toBe(true);
  });

  test("uses no angle-dependent op or function, so the angle convention cannot change it", () => {
    const text = skirtText();
    expect(text).not.toContain("along_angle");
    expect(text).not.toContain("perpendicular");
    expect(text).not.toContain("angle(");
  });

  test("declares the parameters with their defaults", () => {
    expect(skirt().parameters).toEqual({
      ease_waist: 10,
      ease_hip: 40,
      length_adjustment: 0,
      side_shift: 5,
      side_rise: 12.5,
      back_dart_length: 140,
      front_dart_length: 100,
    });
  });
});

for (const [label, measurements] of [
  ["A", SET_A],
  ["B", SET_B],
] as const) {
  describe(`straight skirt: measurement set ${label}`, () => {
    const result = expectOk(compilePattern(skirt()).evaluate({ measurements }));

    test("the waist seams add up to waist + ease (AC7)", () => {
      expectWithin(2 * waistSeams(result), measurements.waist! + DEFAULTS.ease_waist, 1);
    });

    test("the hip widths add up to hip + ease (AC7)", () => {
      expectWithin(2 * hipWidths(result), measurements.hip! + DEFAULTS.ease_hip, 1);
    });

    test("centre back and centre front are the skirt length", () => {
      const length = measurements.skirt_length! + DEFAULTS.length_adjustment;
      expectWithin(curveLength(result, "b_cb"), length, 1);
      expectWithin(curveLength(result, "f_cf"), length, 1);
    });

    test("the legs of each dart are equal", () => {
      const back = [curveLength(result, "b_dart_leg_cb"), curveLength(result, "b_dart_leg_side")];
      const front = [curveLength(result, "f_dart_leg_side"), curveLength(result, "f_dart_leg_cf")];
      expectWithin(back[0]!, back[1]!, 0.01);
      expectWithin(front[0]!, front[1]!, 0.01);
    });

    test("the back and front side seams are equal", () => {
      const back = curveLength(result, "b_hip_curve") + curveLength(result, "b_side_lower");
      const front = curveLength(result, "f_hip_curve") + curveLength(result, "f_side_lower");
      expectWithin(back, front, 1);
    });

    test("back and front exist and do not overlap", () => {
      expect(Object.keys(result.pieces)).toEqual(["back", "front"]);
      const backMax = Math.max(...outlineXs(piece(result, "back")));
      const frontMin = Math.min(...outlineXs(piece(result, "front")));
      expect(backMax).toBeLessThan(frontMin);
    });

    test("the side waist is raised above the centre waist", () => {
      expect(point(result, "b_waist_side").y).toBeLessThan(point(result, "b_waist_cb").y);
      expect(point(result, "f_waist_side").y).toBeLessThan(point(result, "f_waist_cf").y);
    });
  });
}

describe("straight skirt: parameters", () => {
  const compiled = compilePattern(skirt());
  const base = expectOk(compiled.evaluate({ measurements: SET_A }));

  test("ease_hip changes the hip widths by exactly the change", () => {
    const parameters = { ease_hip: 60 };
    const wider = expectOk(compiled.evaluate({ measurements: SET_A, parameters }));
    expect(2 * hipWidths(wider) - 2 * hipWidths(base)).toBeCloseTo(20, 6);
  });

  test("ease_waist changes the waist seams by exactly the change", () => {
    const parameters = { ease_waist: 20 };
    const wider = expectOk(compiled.evaluate({ measurements: SET_A, parameters }));
    expect(2 * waistSeams(wider) - 2 * waistSeams(base)).toBeCloseTo(10, 6);
  });

  test("length_adjustment changes centre back and centre front by exactly the change", () => {
    const shorter = expectOk(
      compiled.evaluate({ measurements: SET_A, parameters: { length_adjustment: -50 } }),
    );
    expect(curveLength(shorter, "b_cb")).toBeCloseTo(SET_A.skirt_length! - 50, 6);
    expect(curveLength(shorter, "f_cf")).toBeCloseTo(SET_A.skirt_length! - 50, 6);
  });

  test("dart lengths move the apexes", () => {
    const longer = expectOk(
      compiled.evaluate({
        measurements: SET_A,
        parameters: { back_dart_length: 150, front_dart_length: 90 },
      }),
    );
    expect(point(longer, "b_dart_apex").y).toBeCloseTo(150, 6);
    expect(point(longer, "f_dart_apex").y).toBeCloseTo(90, 6);
  });
});

describe("straight skirt: missing measurements", () => {
  test("a profile without hip gives a missing_measurement error for hip", () => {
    const { hip: _hip, ...withoutHip } = SET_A;
    const result = evaluatePattern(skirt(), { measurements: withoutHip });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ kind: "missing_measurement", name: "hip" }),
    );
  });
});
