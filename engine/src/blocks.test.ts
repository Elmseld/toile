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
const BODICE_PATH = join(BLOCKS_DIR, "bodice.json");

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

function bodiceText(): string {
  return readFileSync(BODICE_PATH, "utf8");
}

function bodice(): Record<string, unknown> {
  return JSON.parse(bodiceText());
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
  test("there are at least the bodice and the straight skirt", () => {
    expect(blockFiles()).toContain("bodice.json");
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

/** Aldrich size 12: the bust point lies 10 mm below the bust line, so the bust dart crosses it. */
const BODICE_A: Measurements = {
  bust: 880,
  waist: 680,
  neck: 370,
  shoulder_width: 122,
  back_width: 344,
  chest_width: 324,
  back_length: 410,
  armhole_depth: 210,
  front_length: 445,
  bust_height: 265,
  bust_distance: 190,
};

/** A larger figure whose bust point lies above the bust line, so no dart crosses it. */
const BODICE_B: Measurements = {
  bust: 1040,
  waist: 840,
  neck: 400,
  shoulder_width: 130,
  back_width: 380,
  chest_width: 360,
  back_length: 425,
  armhole_depth: 230,
  front_length: 475,
  bust_height: 285,
  bust_distance: 220,
};

const BODICE_DEFAULTS = { ease_bust: 80, ease_waist: 40, ease_armhole_depth: 10 };

const BODICE_ARMHOLES = ["b_armhole_upper", "b_armhole_lower", "f_armhole_lower", "f_armhole_upper"];

/** The x where the line through points `a` and `b` crosses the horizontal line at `y`. */
function xAtY(a: { x: number; y: number }, b: { x: number; y: number }, y: number): number {
  return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
}

/**
 * The back and front widths on the bust line (through the underarm points), net of the bust
 * dart where it crosses the line. The wedge is measured from the drafted dart legs, independently
 * of the block's own formulas.
 */
function bustLineWidths(result: ComputedPattern): number {
  const back = between(result, "b_underarm_cb", "b_side_top");
  const bustLine = point(result, "f_underarm_cf").y;
  const bp = point(result, "f_bp");
  const wedge =
    bp.y > bustLine
      ? xAtY(bp, point(result, "f_bdart_neck"), bustLine) -
        xAtY(bp, point(result, "f_bdart_arm"), bustLine)
      : 0;
  const front = point(result, "f_underarm_cf").x - point(result, "f_side_top").x - wedge;
  return back + front;
}

function bodiceWaistSeams(result: ComputedPattern): number {
  return (
    curveLength(result, "b_waist_cb_seg") +
    curveLength(result, "b_waist_side_seg") +
    curveLength(result, "f_waist_cf_seg") +
    curveLength(result, "f_waist_side_seg")
  );
}

/** The shoulder seam without the dart intake, which is its length once the dart is sewn closed. */
function shoulderSeam(result: ComputedPattern, side: "back" | "front"): number {
  const prefix = side === "back" ? "b" : "f";
  return (
    curveLength(result, `${prefix}_shoulder_neck`) + curveLength(result, `${prefix}_shoulder_arm`)
  );
}

function outlineCurves(definition: Record<string, unknown>, pieceName: string): string[] {
  const pieces = definition.pieces as { name: string; outline: { curve: string }[] }[];
  const found = pieces.find((candidate) => candidate.name === pieceName);
  if (found === undefined) throw new Error(`piece ${pieceName} is not defined`);
  return found.outline.map((entry) => entry.curve);
}

function curveTypes(definition: Record<string, unknown>): Record<string, string> {
  const curves = definition.curves as { name: string; type: string }[];
  return Object.fromEntries(curves.map((curve) => [curve.name, curve.type]));
}

describe("bodice: definition", () => {
  test("names the block and its drafting source", () => {
    const definition = bodice();
    expect(definition.version).toBe(1);
    expect(definition.name).toBe("Bodice");
    expect(typeof definition.source).toBe("string");
    expect(String(definition.source)).toContain("Aldrich");
    expect(String(definition.source)).toContain("close fitting bodice block");
  });

  test("declares exactly the eleven catalogue measurements", () => {
    const measurements = bodice().measurements as string[];
    expect(measurements).toEqual([
      "bust",
      "waist",
      "neck",
      "shoulder_width",
      "back_width",
      "chest_width",
      "back_length",
      "armhole_depth",
      "front_length",
      "bust_height",
      "bust_distance",
    ]);
    for (const key of measurements) expect(isMeasurementKey(key)).toBe(true);
  });

  test("declares the parameters with their defaults (AC2)", () => {
    expect(bodice().parameters).toEqual({
      ...BODICE_DEFAULTS,
      ease_back_width: 10,
      side_shift: 10,
      back_neck_rise: 20,
      front_neck_extra: 10,
      back_shoulder_drop: 40,
      front_shoulder_drop: 40,
      back_shoulder_dart: 10,
      back_shoulder_dart_length: 80,
      back_waist_dart_gap: 20,
      front_waist_dart_gap: 20,
    });
  });

  test("has a back and a front piece, in that order", () => {
    const pieces = bodice().pieces as { name: string }[];
    expect(pieces.map((candidate) => candidate.name)).toEqual(["back", "front"]);
  });

  test("the back outline has a neckline, a darted shoulder, an armhole, side, darted waist and centre back", () => {
    const definition = bodice();
    expect(outlineCurves(definition, "back")).toEqual([
      "b_neckline",
      "b_shoulder_neck",
      "b_sdart_leg_neck",
      "b_sdart_leg_arm",
      "b_shoulder_arm",
      "b_armhole_upper",
      "b_armhole_lower",
      "b_side",
      "b_waist_side_seg",
      "b_wdart_leg_side",
      "b_wdart_leg_cb",
      "b_waist_cb_seg",
      "b_cb",
    ]);
    const types = curveTypes(definition);
    for (const name of ["b_neckline", "b_armhole_upper", "b_armhole_lower"]) {
      expect(types[name]).toBe("cubic");
    }
  });

  test("the front outline has a neckline, centre front, darted waist, side, an armhole and a darted shoulder", () => {
    const definition = bodice();
    expect(outlineCurves(definition, "front")).toEqual([
      "f_neckline",
      "f_cf",
      "f_waist_cf_seg",
      "f_wdart_leg_cf",
      "f_wdart_leg_side",
      "f_waist_side_seg",
      "f_side",
      "f_armhole_lower",
      "f_armhole_upper",
      "f_shoulder_arm",
      "f_bdart_leg_arm",
      "f_bdart_leg_neck",
      "f_shoulder_neck",
    ]);
    const types = curveTypes(definition);
    for (const name of ["f_neckline", "f_armhole_lower", "f_armhole_upper"]) {
      expect(types[name]).toBe("cubic");
    }
  });

  test("the bust dart legs meet at the bust point", () => {
    const curves = bodice().curves as { name: string; from: string; to: string }[];
    const legs = curves.filter((curve) => curve.name.startsWith("f_bdart_leg_"));
    expect(legs.map((leg) => [leg.from, leg.to])).toEqual([
      ["f_bdart_arm", "f_bp"],
      ["f_bp", "f_bdart_neck"],
    ]);
  });
});

for (const [label, measurements] of [
  ["A", BODICE_A],
  ["B", BODICE_B],
] as const) {
  describe(`bodice: measurement set ${label}`, () => {
    const result = expectOk(compilePattern(bodice()).evaluate({ measurements }));
    const bustLine = measurements.armhole_depth! + BODICE_DEFAULTS.ease_armhole_depth;

    test("the bust line lies through the underarm points", () => {
      expect(point(result, "b_underarm_cb").y).toBeCloseTo(bustLine, 6);
      expect(point(result, "f_underarm_cf").y).toBeCloseTo(bustLine, 6);
      expect(point(result, "b_side_top").y).toBeCloseTo(bustLine, 6);
      expect(point(result, "f_side_top").y).toBeCloseTo(bustLine, 6);
    });

    test("the widths on the bust line add up to bust + ease, net of darts (AC4)", () => {
      expectWithin(2 * bustLineWidths(result), measurements.bust! + BODICE_DEFAULTS.ease_bust, 2);
    });

    test("the waist seams add up to waist + ease, net of darts (AC4)", () => {
      expectWithin(
        2 * bodiceWaistSeams(result),
        measurements.waist! + BODICE_DEFAULTS.ease_waist,
        2,
      );
    });

    test("the back and front shoulder seams are equal and the shoulder width (AC4)", () => {
      expectWithin(shoulderSeam(result, "back"), shoulderSeam(result, "front"), 1);
      expectWithin(shoulderSeam(result, "back"), measurements.shoulder_width!, 1);
      expectWithin(shoulderSeam(result, "front"), measurements.shoulder_width!, 1);
    });

    test("the legs of each dart are equal", () => {
      for (const [a, b] of [
        ["b_sdart_leg_neck", "b_sdart_leg_arm"],
        ["b_wdart_leg_side", "b_wdart_leg_cb"],
        ["f_wdart_leg_cf", "f_wdart_leg_side"],
        ["f_bdart_leg_arm", "f_bdart_leg_neck"],
      ] as const) {
        expectWithin(curveLength(result, a), curveLength(result, b), 0.01);
      }
    });

    test("the back and front side seams are equal", () => {
      expectWithin(curveLength(result, "b_side"), curveLength(result, "f_side"), 1);
    });

    test("only the bust dart may cross the bust line", () => {
      expect(point(result, "b_wdart_apex").y).toBeGreaterThan(bustLine);
      expect(point(result, "f_wdart_apex").y).toBeGreaterThanOrEqual(bustLine - 1e-9);
      expect(point(result, "b_sdart_apex").y).toBeLessThan(bustLine);
    });

    test("the bust dart opens toward the side seam", () => {
      expect(point(result, "f_bdart_arm").x).toBeLessThan(point(result, "f_bdart_neck").x);
      expect(result.values.bust_dart_angle).toBeGreaterThan(0);
    });

    test("armhole_length is the sum of the four armhole curves (AC3)", () => {
      const sum = BODICE_ARMHOLES.reduce((total, name) => total + curveLength(result, name), 0);
      const back = result.values.back_armhole_length!;
      const front = result.values.front_armhole_length!;
      expect(result.values.armhole_length).toBeCloseTo(sum, 6);
      expect(back).toBeGreaterThan(0);
      expect(front).toBeGreaterThan(0);
      expect(back + front).toBeCloseTo(result.values.armhole_length!, 6);
    });

    test("the armholes end at the side and shoulder points", () => {
      const backLower = result.curves.b_armhole_lower!;
      const frontUpper = result.curves.f_armhole_upper!;
      expect(backLower.to.x).toBeCloseTo(point(result, "b_side_top").x, 6);
      expect(backLower.to.y).toBeCloseTo(point(result, "b_side_top").y, 6);
      expect(frontUpper.to.x).toBeCloseTo(point(result, "f_shoulder").x, 6);
      expect(frontUpper.to.y).toBeCloseTo(point(result, "f_shoulder").y, 6);
    });

    test("back and front exist and do not overlap", () => {
      expect(Object.keys(result.pieces)).toEqual(["back", "front"]);
      const backMax = Math.max(...outlineXs(piece(result, "back")));
      const frontMin = Math.min(...outlineXs(piece(result, "front")));
      expect(backMax).toBeLessThan(frontMin);
    });

    test("the front neckline runs down from the neck point to centre front", () => {
      expect(point(result, "f_neck").y).toBeLessThan(point(result, "f_shoulder").y);
      expect(point(result, "f_neck_cf").y).toBeGreaterThan(point(result, "f_neck").y);
    });
  });
}

test("bodice: the bust point lies below the bust line in set A and above it in set B", () => {
  const compiled = compilePattern(bodice());
  const a = expectOk(compiled.evaluate({ measurements: BODICE_A }));
  const b = expectOk(compiled.evaluate({ measurements: BODICE_B }));
  expect(point(a, "f_bp").y).toBeGreaterThan(point(a, "f_underarm_cf").y);
  expect(a.values.bust_dart_at_underarm).toBeGreaterThan(0);
  expect(point(b, "f_bp").y).toBeLessThan(point(b, "f_underarm_cf").y);
  expect(b.values.bust_dart_at_underarm).toBe(0);
});

describe("bodice: parameters", () => {
  const compiled = compilePattern(bodice());
  const base = expectOk(compiled.evaluate({ measurements: BODICE_A }));

  test("ease_bust changes the bust line widths by exactly the change", () => {
    const parameters = { ease_bust: 100 };
    const wider = expectOk(compiled.evaluate({ measurements: BODICE_A, parameters }));
    expect(2 * bustLineWidths(wider) - 2 * bustLineWidths(base)).toBeCloseTo(20, 6);
  });

  test("ease_waist changes the waist seams by exactly the change", () => {
    const parameters = { ease_waist: 60 };
    const wider = expectOk(compiled.evaluate({ measurements: BODICE_A, parameters }));
    expect(2 * bodiceWaistSeams(wider) - 2 * bodiceWaistSeams(base)).toBeCloseTo(20, 6);
  });

  test("ease_armhole_depth lowers the underarm line by exactly the change", () => {
    const parameters = { ease_armhole_depth: 30 };
    const deeper = expectOk(compiled.evaluate({ measurements: BODICE_A, parameters }));
    for (const name of ["b_underarm_cb", "f_side_top"]) {
      expect(point(deeper, name).y - point(base, name).y).toBeCloseTo(20, 6);
    }
    expect(deeper.values.armhole_length).toBeGreaterThan(base.values.armhole_length!);
  });

  test("armhole_length follows a user offset on an armhole point", () => {
    const moved = expectOk(
      compiled.evaluate(
        { measurements: BODICE_A },
        { offsets: { b_width_pt: { dx: 15, dy: 0 } } },
      ),
    );
    const sum = BODICE_ARMHOLES.reduce((total, name) => total + curveLength(moved, name), 0);
    expect(moved.values.armhole_length).toBeCloseTo(sum, 6);
    expect(moved.values.armhole_length).not.toBeCloseTo(base.values.armhole_length!, 3);
  });
});

describe("bodice: missing measurements", () => {
  test("a profile without armhole_depth gives a missing_measurement error for it", () => {
    const { armhole_depth: _armholeDepth, ...withoutArmholeDepth } = BODICE_A;
    const result = evaluatePattern(bodice(), { measurements: withoutArmholeDepth });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ kind: "missing_measurement", name: "armhole_depth" }),
    );
  });
});

for (const [label, measurements] of [
  ["A", BODICE_A],
  ["B", BODICE_B],
] as const) {
  describe(`bodice: waist suppression, measurement set ${label}`, () => {
    const result = expectOk(compilePattern(bodice()).evaluate({ measurements }));
    const wedge =
      point(result, "f_bp").y > point(result, "f_underarm_cf").y
        ? xAtY(
            point(result, "f_bp"),
            point(result, "f_bdart_neck"),
            point(result, "f_underarm_cf").y,
          ) -
          xAtY(
            point(result, "f_bp"),
            point(result, "f_bdart_arm"),
            point(result, "f_underarm_cf").y,
          )
        : 0;

    test("the back and front side seams have the same length and slant", () => {
      expectWithin(curveLength(result, "b_side"), curveLength(result, "f_side"), 0.01);
      const backSlant = point(result, "b_side_top").x - point(result, "b_waist_side").x;
      const frontSlant = point(result, "f_waist_side").x - point(result, "f_side_top").x;
      expectWithin(backSlant, frontSlant, 0.01);
    });

    test("the back waist dart takes as much as the side seam slant", () => {
      const dart = point(result, "b_wdart_side").x - point(result, "b_wdart_cb").x;
      const slant = point(result, "b_side_top").x - point(result, "b_waist_side").x;
      expect(dart).toBeGreaterThan(0);
      expectWithin(dart, slant, 0.01);
    });

    test("the front waist dart also takes the width of the bust dart on the bust line", () => {
      const front = point(result, "f_wdart_cf").x - point(result, "f_wdart_side").x;
      const back = point(result, "b_wdart_side").x - point(result, "b_wdart_cb").x;
      expectWithin(front - back, wedge, 0.01);
    });
  });
}
