// Tests of the block definitions in engine/blocks/ (ADR 0006). The engine has no block registry,
// so the files are read here with fs; the Phoenix app reads them at compile time.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compilePattern,
  compileProject,
  distance,
  evaluatePattern,
  evaluateProject,
  placeLabel,
  validateDefinition,
} from "./geometry";
import type {
  ComputedCurve,
  ComputedPattern,
  ComputedPiece,
  PatternResult,
  Point,
  UserOffset,
} from "./geometry";
import { cubicAt } from "./geometry/bezier";
import { insidePolygon, outlinePolygon } from "./geometry/label";
import { isMeasurementKey, MEASUREMENT_KEYS } from "./measurements";

const BLOCKS_DIR = join(import.meta.dir, "..", "blocks");
const SKIRT_PATH = join(BLOCKS_DIR, "straight_skirt.json");
const BODICE_PATH = join(BLOCKS_DIR, "bodice.json");
const SLEEVE_PATH = join(BLOCKS_DIR, "straight_sleeve.json");

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

/** The part names (block keys) a definition's imports refer to, each once. */
function importedParts(definition: unknown): string[] {
  const { imports = {} } = definition as { imports?: Record<string, string> };
  return [...new Set(Object.values(imports).map((reference) => reference.split(".")[0]!))];
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
      const sources = importedParts(definition);
      if (sources.length === 0) {
        expectOk(evaluatePattern(definition, { measurements: FULL_PROFILE }));
        return;
      }
      // A block with imports evaluates in a project with the blocks it imports from, each part
      // named by its block key.
      const parts = [
        ...sources.map((name) => ({ name, definition: readJson(join(BLOCKS_DIR, `${name}.json`)) })),
        { name: file.replace(/\.json$/, ""), definition },
      ];
      const result = evaluateProject(parts, { measurements: FULL_PROFILE });
      for (const part of Object.values(result.parts)) expectOk(part);
      expect(result.ok).toBe(true);
    });

    test(`${file} imports only formulas of existing block files`, () => {
      const { imports = {} } = readJson(join(BLOCKS_DIR, file)) as {
        imports?: Record<string, string>;
      };
      for (const reference of Object.values(imports)) {
        const [part, value] = reference.split(".");
        expect(blockFiles()).toContain(`${part}.json`);
        const { formulas } = readJson(join(BLOCKS_DIR, `${part}.json`)) as {
          formulas: Record<string, string>;
        };
        expect(Object.keys(formulas)).toContain(value!);
      }
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

/** Aldrich size 12: the bust point lies below the bust line, so the bust dart crosses it. */
const BODICE_A: Measurements = {
  bust: 880,
  waist: 680,
  neck: 370,
  shoulder_width: 122,
  back_width: 344,
  chest_width: 324,
  back_length: 410,
  armhole_depth: 210,
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
  bust_height: 285,
  bust_distance: 220,
};

/** A large, full-busted figure: half the bust exceeds the chest width by 210 mm. */
const BODICE_LARGE: Measurements = {
  bust: 1200,
  waist: 1000,
  neck: 420,
  shoulder_width: 135,
  back_width: 400,
  chest_width: 390,
  back_length: 430,
  armhole_depth: 240,
  bust_height: 320,
  bust_distance: 240,
};

/**
 * A full figure with a short armhole depth and a long bust height, so the bust point lies about
 * 85 mm below the bust line and the bust dart takes a wide wedge out of it.
 */
const BODICE_LOW_BUST: Measurements = {
  bust: 1060,
  waist: 900,
  neck: 355,
  shoulder_width: 125,
  back_width: 390,
  chest_width: 390,
  back_length: 420,
  armhole_depth: 200,
  bust_height: 340,
  bust_distance: 210,
};

const BODICE_SETS = [
  ["A", BODICE_A],
  ["B", BODICE_B],
  ["large", BODICE_LARGE],
  ["low bust", BODICE_LOW_BUST],
] as const;

const BODICE_DEFAULTS = { ease_bust: 80, ease_waist: 40, ease_armhole_depth: 10 };

const BUST_DART = { rate: 0.12, offset: 50, max: 20 };

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

  test("declares exactly the ten catalogue measurements", () => {
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
      bust_dart_rate: BUST_DART.rate,
      bust_dart_offset: BUST_DART.offset,
      max_bust_dart_angle: BUST_DART.max,
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

for (const [label, measurements] of BODICE_SETS) {
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

    test("the front shoulder point is level with the back shoulder point", () => {
      expect(point(result, "f_shoulder").y).toBeCloseTo(point(result, "b_shoulder").y, 6);
    });

    // Holds with the default, equal front and back shoulder drops; the closed form for any
    // drops is pinned in "bodice: front neck point".
    test("the front neck point lies no lower than the back neck point (equal shoulder drops)", () => {
      expect(point(result, "f_neck").y).toBeLessThanOrEqual(point(result, "b_neck").y + 1e-9);
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

function dartWidth(result: ComputedPattern): number {
  return between(result, "f_bdart_neck", "f_bdart_arm");
}

/** The bust excess of a measurement set: half the bust less the chest width (mm). */
function bustExcess(measurements: Measurements): number {
  return measurements.bust! / 2 - measurements.chest_width!;
}

/** The checks every bust dart must pass: AC4 and the front shoulder level with the back. */
function expectBalanced(result: ComputedPattern, measurements: Measurements): void {
  expectWithin(shoulderSeam(result, "back"), shoulderSeam(result, "front"), 1);
  expectWithin(2 * bustLineWidths(result), measurements.bust! + BODICE_DEFAULTS.ease_bust, 2);
  expectWithin(2 * bodiceWaistSeams(result), measurements.waist! + BODICE_DEFAULTS.ease_waist, 2);
  expect(point(result, "f_shoulder").y).toBeCloseTo(point(result, "b_shoulder").y, 6);
}

describe("bodice: bust dart size", () => {
  const compiled = compilePattern(bodice());
  const evaluate = (measurements: Measurements, parameters = {}) =>
    expectOk(compiled.evaluate({ measurements, parameters }));

  test("the angle is bust_dart_rate times the bust excess over bust_dart_offset", () => {
    for (const [, measurements] of BODICE_SETS) {
      const result = evaluate(measurements);
      expect(result.values.bust_excess).toBeCloseTo(bustExcess(measurements), 9);
      expect(result.values.bust_dart_angle).toBeCloseTo(
        BUST_DART.rate * (bustExcess(measurements) - BUST_DART.offset),
        9,
      );
    }
  });

  test("the dart width is plausible from an average to a large figure", () => {
    const a = dartWidth(evaluate(BODICE_A));
    const b = dartWidth(evaluate(BODICE_B));
    const large = dartWidth(evaluate(BODICE_LARGE));
    expect(a).toBeGreaterThan(25);
    expect(a).toBeLessThan(45);
    expect(b).toBeGreaterThan(50);
    expect(b).toBeLessThan(75);
    expect(large).toBeGreaterThan(85);
    expect(large).toBeLessThan(0.8 * BODICE_LARGE.shoulder_width!);
  });

  test("the dart width changes by under 0.8 mm per mm of chest_width and 0.4 mm per mm of bust", () => {
    for (const [, measurements] of BODICE_SETS) {
      const slope = (key: string) => {
        const at = (delta: number) =>
          dartWidth(evaluate({ ...measurements, [key]: measurements[key]! + delta }));
        return Math.abs(at(5) - at(-5)) / 10;
      };
      expect(slope("chest_width")).toBeLessThan(0.8);
      expect(slope("bust")).toBeLessThan(0.4);
      expect(slope("bust_height")).toBeLessThan(0.5);
    }
  });

  test("front_length does not change the pattern", () => {
    const short = evaluate({ ...BODICE_A, front_length: 400 });
    const long = evaluate({ ...BODICE_A, front_length: 520 });
    expect(long.points).toEqual(short.points);
    expect(long.values).toEqual(short.values);
  });

  test("the drafted front length of sets A and B is within 2 mm of their measured front length", () => {
    for (const [measurements, frontLength] of [
      [BODICE_A, 445],
      [BODICE_B, 475],
    ] as const) {
      const result = evaluate(measurements);
      const drafted =
        between(result, "f_neck", "f_bp") + point(result, "f_waist_cf").y - point(result, "f_bp").y;
      expectWithin(drafted, frontLength, 2);
    }
  });

  test("max_bust_dart_angle caps the dart for an implausibly large bust excess", () => {
    const measurements: Measurements = { ...BODICE_LARGE, chest_width: 340 };
    const result = evaluate(measurements);
    expect(BUST_DART.rate * (bustExcess(measurements) - BUST_DART.offset)).toBeGreaterThan(
      BUST_DART.max,
    );
    expect(result.values.bust_dart_angle).toBeCloseTo(BUST_DART.max, 9);
    expect(dartWidth(result)).toBeLessThan(0.8 * measurements.shoulder_width!);
    expectBalanced(result, measurements);
  });

  test("the dart is zero and the front neck point level with the back one for a small bust excess", () => {
    const measurements: Measurements = { ...BODICE_A, chest_width: 400 };
    const result = evaluate(measurements);
    expect(bustExcess(measurements)).toBeLessThan(BUST_DART.offset);
    expect(result.values.bust_dart_angle).toBe(0);
    expect(dartWidth(result)).toBeCloseTo(0, 9);
    expect(point(result, "f_neck").y).toBeCloseTo(point(result, "b_neck").y, 6);
    expectBalanced(result, measurements);
  });

  test("the dart parameters change the angle", () => {
    expect(evaluate(BODICE_B, { max_bust_dart_angle: 10 }).values.bust_dart_angle).toBeCloseTo(10, 9);
    expectBalanced(evaluate(BODICE_B, { max_bust_dart_angle: 10 }), BODICE_B);
    expect(evaluate(BODICE_A, { bust_dart_rate: 0 }).values.bust_dart_angle).toBe(0);
    expect(evaluate(BODICE_A, { bust_dart_offset: 0 }).values.bust_dart_angle).toBeCloseTo(
      BUST_DART.rate * bustExcess(BODICE_A),
      9,
    );
  });
});

/**
 * How far the front neck point lies above the back one (mm), in closed form: the front neck
 * point is placed so that the front shoulder point, rotated by the dart angle about the bust
 * point, is level with the back shoulder point. With no dart this is the difference of the
 * shoulder drops; the dart adds `r * (sin(phi - angle) - sin(phi))`, where `r` and `phi` are the
 * distance and direction from the bust point to the closed front shoulder point.
 */
function frontNeckRise(
  measurements: Measurements,
  dartAngle: number,
  drops = { back: 40, front: 40 },
): number {
  const neckWidth = measurements.neck! / 5 - 2;
  const bpDx = measurements.bust_distance! / 2 - neckWidth;
  const bpDrop = Math.sqrt(measurements.bust_height! ** 2 - bpDx ** 2);
  const shoulderDx = Math.sqrt(measurements.shoulder_width! ** 2 - drops.front ** 2);
  const r = Math.hypot(bpDx - shoulderDx, drops.front - bpDrop);
  const phi = Math.atan2(drops.front - bpDrop, bpDx - shoulderDx);
  const theta = (dartAngle * Math.PI) / 180;
  return r * (Math.sin(phi - theta) - Math.sin(phi)) + drops.front - drops.back;
}

describe("bodice: front neck point", () => {
  const compiled = compilePattern(bodice());
  const evaluate = (measurements: Measurements, parameters = {}) =>
    expectOk(compiled.evaluate({ measurements, parameters }));
  const rise = (result: ComputedPattern) => point(result, "b_neck").y - point(result, "f_neck").y;

  test("with no dart it is level with the back neck point when the shoulder drops are equal", () => {
    for (const [, measurements] of BODICE_SETS) {
      const result = evaluate(measurements, { bust_dart_rate: 0 });
      expect(rise(result)).toBeCloseTo(0, 6);
    }
  });

  test("with no dart it lies above the back one by the difference of the shoulder drops", () => {
    const drops = { back: 30, front: 45 };
    const result = evaluate(BODICE_A, {
      bust_dart_rate: 0,
      back_shoulder_drop: drops.back,
      front_shoulder_drop: drops.front,
    });
    expect(rise(result)).toBeCloseTo(drops.front - drops.back, 6);
    expect(rise(result)).toBeCloseTo(frontNeckRise(BODICE_A, 0, drops), 6);
  });

  test("it rises above the back one by the closed-form rise for the dart angle", () => {
    for (const [, measurements] of BODICE_SETS) {
      const result = evaluate(measurements);
      const angle = result.values.bust_dart_angle!;
      expect(angle).toBeGreaterThan(0);
      expect(rise(result)).toBeCloseTo(frontNeckRise(measurements, angle), 6);
    }
  });

  test("the rise grows with the dart angle", () => {
    for (const [, measurements] of BODICE_SETS) {
      let previous = -Infinity;
      for (let angle = 0; angle <= BUST_DART.max; angle += 2) {
        // A rate this steep puts every set at the cap, so the cap sets the angle.
        const result = evaluate(measurements, {
          bust_dart_offset: 0,
          bust_dart_rate: 10,
          max_bust_dart_angle: angle,
        });
        expect(result.values.bust_dart_angle).toBeCloseTo(angle, 9);
        expect(rise(result)).toBeCloseTo(frontNeckRise(measurements, angle), 6);
        expect(rise(result)).toBeGreaterThan(previous);
        previous = rise(result);
      }
    }
  });
});

/** The names the sleeve imports from the bodice (ADR 0007), plus the total armhole length. */
const BODICE_INTERFACE = [
  "armhole_length",
  "back_armhole_length",
  "front_armhole_length",
  "back_armhole_to_notch",
  "front_armhole_to_notch",
];

describe("bodice: values for other blocks", () => {
  // The sleeve imports these names. Renaming one means migrating the block copies stored in
  // pattern projects (ADR 0006, ADR 0007), so this test pins them.
  test("exposes the armhole lengths and the arc lengths from the side points to the notches", () => {
    const formulas = bodice().formulas as Record<string, string>;
    const result = expectOk(compilePattern(bodice()).evaluate({ measurements: BODICE_A }));
    for (const name of BODICE_INTERFACE) {
      expect(Object.keys(formulas)).toContain(name);
      expect(result.values[name]).toBeGreaterThan(0);
    }
  });

  for (const [label, measurements] of BODICE_SETS) {
    test(`set ${label}: the notch values are the lower armhole curves`, () => {
      const result = expectOk(compilePattern(bodice()).evaluate({ measurements }));
      expect(result.values.back_armhole_to_notch).toBe(curveLength(result, "b_armhole_lower"));
      expect(result.values.front_armhole_to_notch).toBe(curveLength(result, "f_armhole_lower"));
    });
  }
});

describe("bodice: notches", () => {
  test("the back armhole has a double notch at the back width point, the front one a single at the chest point", () => {
    const pieces = bodice().pieces as { name: string; notches?: unknown }[];
    expect(pieces.map((candidate) => candidate.notches)).toEqual([
      [{ curve: "b_armhole_lower", distance: "0", marks: 2 }],
      [{ curve: "f_armhole_upper", distance: "0" }],
    ]);
  });

  for (const [label, measurements] of BODICE_SETS) {
    test(`set ${label}: the notches lie on the back width and chest points, marks inside the piece`, () => {
      const result = expectOk(compilePattern(bodice()).evaluate({ measurements }));
      for (const [pieceName, pointName, marks] of [
        ["back", "b_width_pt", 2],
        ["front", "f_chest", 1],
      ] as const) {
        const computed = piece(result, pieceName);
        expect(computed.notches).toHaveLength(1);
        const notch = computed.notches[0]!;
        expectWithin(distance(notch.point, point(result, pointName)), 0, 0.01);
        expect(notch.marks).toHaveLength(marks);
        const polygon = outlinePolygon(computed);
        for (const mark of notch.marks) expect(insidePolygon(polygon, mark.to.x, mark.to.y)).toBe(true);
      }
    });
  }
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

for (const [label, measurements] of BODICE_SETS) {
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

/**
 * The profile from the user report on a wobbly (S-shaped) armhole: its back width point lies
 * almost straight below the back shoulder point. The report also gave hip 1080 and front_length
 * 500, which the bodice does not use.
 */
const BODICE_REPORTED: Measurements = {
  bust: 1060,
  waist: 900,
  neck: 355,
  shoulder_width: 125,
  back_width: 380,
  chest_width: 390,
  back_length: 420,
  armhole_depth: 200,
  bust_height: 340,
  bust_distance: 210,
};

/** The two armholes, each as its cubics in drawing order: back from the shoulder, front to it. */
const ARMHOLES = {
  back: ["b_armhole_upper", "b_armhole_lower"],
  front: ["f_armhole_lower", "f_armhole_upper"],
} as const;

const ARMHOLE_SAMPLES = 64;

/** Allowed numerical noise in the sine of a turn or in a y step between samples. */
const ARMHOLE_NOISE = 1e-9;

type Cubic = { from: Point; c1: Point; c2: Point; to: Point };

function cubic(result: ComputedPattern, name: string): Cubic {
  const curve = result.curves[name];
  if (curve === undefined || curve.type !== "cubic") throw new Error(`${name} is not a cubic`);
  return curve;
}

/** Points along the cubics in order, each junction once. */
function samples(result: ComputedPattern, names: readonly string[]): Point[] {
  const points: Point[] = [];
  for (const name of names) {
    const { from, c1, c2, to } = cubic(result, name);
    for (let i = points.length === 0 ? 0 : 1; i <= ARMHOLE_SAMPLES; i++) {
      points.push(cubicAt(from, c1, c2, to, i / ARMHOLE_SAMPLES));
    }
  }
  return points;
}

/**
 * The sine of the turn at every inner sample: positive turns clockwise on screen (y down),
 * negative counter-clockwise. A curve without inflection has one sign throughout.
 */
function turns(points: readonly Point[]): number[] {
  const result: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = { x: points[i]!.x - points[i - 1]!.x, y: points[i]!.y - points[i - 1]!.y };
    const b = { x: points[i + 1]!.x - points[i]!.x, y: points[i + 1]!.y - points[i]!.y };
    result.push((a.x * b.y - a.y * b.x) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)));
  }
  return result;
}

/** The sine of the angle from direction `a -> b` to direction `c -> d`. */
function sineBetween(a: Point, b: Point, c: Point, d: Point): number {
  const u = { x: b.x - a.x, y: b.y - a.y };
  const v = { x: d.x - c.x, y: d.y - c.y };
  return (u.x * v.y - u.y * v.x) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
}

/** The cosine of the angle between directions `a -> b` and `c -> d`. */
function cosineBetween(a: Point, b: Point, c: Point, d: Point): number {
  const u = { x: b.x - a.x, y: b.y - a.y };
  const v = { x: d.x - c.x, y: d.y - c.y };
  return (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
}

/** Both armholes turn counter-clockwise on screen at every sample, the junction included. */
function expectArmholesTurnOneWay(result: ComputedPattern): void {
  for (const names of Object.values(ARMHOLES)) {
    const sines = turns(samples(result, names));
    expect(Math.max(...sines)).toBeLessThan(ARMHOLE_NOISE);
    expect(Math.min(...sines)).toBeLessThan(0);
  }
}

for (const [label, measurements] of [...BODICE_SETS, ["reported", BODICE_REPORTED]] as const) {
  describe(`bodice: armhole shape, measurement set ${label}`, () => {
    const result = expectOk(compilePattern(bodice()).evaluate({ measurements }));

    // The back armhole runs down from the shoulder and turns toward the side point, the front
    // one runs from the side point and turns up to the shoulder: both counter-clockwise on
    // screen. A turn the other way anywhere is the S-shape of the user report.
    test("each armhole turns one way from end to end, without an S-shape", () => {
      expectArmholesTurnOneWay(result);
    });

    test("the back armhole only runs down and the front one only up", () => {
      const back = samples(result, ARMHOLES.back);
      const front = samples(result, ARMHOLES.front);
      for (let i = 1; i < back.length; i++) {
        expect(back[i]!.y - back[i - 1]!.y).toBeGreaterThan(-ARMHOLE_NOISE);
      }
      for (let i = 1; i < front.length; i++) {
        expect(front[i]!.y - front[i - 1]!.y).toBeLessThan(ARMHOLE_NOISE);
      }
    });

    test("the curves meet with one tangent at the back width point and the chest point", () => {
      const [backUpper, backLower] = ARMHOLES.back.map((name) => cubic(result, name));
      const [frontLower, frontUpper] = ARMHOLES.front.map((name) => cubic(result, name));
      for (const [incoming, outgoing] of [
        [backUpper!, backLower!],
        [frontLower!, frontUpper!],
      ] as const) {
        const join = outgoing.from;
        expect(Math.abs(sineBetween(incoming.c2, join, join, outgoing.c1))).toBeLessThan(1e-9);
        expect(cosineBetween(incoming.c2, join, join, outgoing.c1)).toBeGreaterThan(0);
      }
    });

    test("each armhole leaves the shoulder seam at a right angle, within 1 degree", () => {
      const backSeam = cosineBetween(
        point(result, "b_sdart_arm"),
        point(result, "b_shoulder"),
        point(result, "b_shoulder"),
        point(result, "b_arm_c1"),
      );
      const frontSeam = cosineBetween(
        point(result, "f_bdart_arm"),
        point(result, "f_shoulder"),
        point(result, "f_shoulder"),
        point(result, "f_arm_c4"),
      );
      expect(Math.abs(backSeam)).toBeLessThan(Math.sin((1 * Math.PI) / 180));
      expect(Math.abs(frontSeam)).toBeLessThan(Math.sin((1 * Math.PI) / 180));
    });

    test("each armhole reaches the side point horizontally", () => {
      expect(point(result, "b_arm_c4").y).toBeCloseTo(point(result, "b_side_top").y, 9);
      expect(point(result, "b_arm_c4").x).toBeLessThan(point(result, "b_side_top").x);
      expect(point(result, "f_arm_c1").y).toBeCloseTo(point(result, "f_side_top").y, 9);
      expect(point(result, "f_arm_c1").x).toBeGreaterThan(point(result, "f_side_top").x);
    });
  });
}

/**
 * How far (mm) each armhole may pass inside the vertical line through the back width point or
 * the chest point, above that point. In the low-bust set the back shoulder point already lies
 * inside the back width line, so the curve cannot stay outside it.
 */
const ARMHOLE_MAX_INSIDE: Record<(typeof BODICE_SETS)[number][0], number> = {
  A: 3,
  B: 3,
  large: 3,
  "low bust": 7,
};

/** The largest distance (mm) the cubic passes on the inner side of the vertical line at `x`. */
function maxInside(curve: Cubic, x: number, side: "left" | "right"): number {
  let inside = 0;
  for (let i = 0; i <= ARMHOLE_SAMPLES; i++) {
    const p = cubicAt(curve.from, curve.c1, curve.c2, curve.to, i / ARMHOLE_SAMPLES);
    inside = Math.max(inside, side === "left" ? x - p.x : p.x - x);
  }
  return inside;
}

for (const [label, measurements] of BODICE_SETS) {
  test(`bodice: set ${label}, each armhole passes at most ${ARMHOLE_MAX_INSIDE[label]} mm inside the back width or chest line`, () => {
    const result = expectOk(compilePattern(bodice()).evaluate({ measurements }));
    const limit = ARMHOLE_MAX_INSIDE[label];
    // Back: centre back is on the left, so inside is left of the line; front: the other way.
    const backUpper = cubic(result, "b_armhole_upper");
    const frontUpper = cubic(result, "f_armhole_upper");
    expect(maxInside(backUpper, point(result, "b_width_pt").x, "left")).toBeLessThan(limit);
    expect(maxInside(frontUpper, point(result, "f_chest").x, "right")).toBeLessThan(limit);
  });
}

describe("bodice: armhole shape over a range of widths", () => {
  const compiled = compilePattern(bodice());

  // Covers a back width point well inside the shoulder point (300 mm), almost straight below it
  // (the user report) and outside it (400 mm), and chest widths on either side. A back width
  // point outside the line from the shoulder point to the side point (set A from about 415 mm)
  // leaves no curve without a turn the other way.
  test("each armhole turns one way for back widths 300 to 400 mm and chest widths 280 to 400 mm", () => {
    for (const base of [BODICE_A, BODICE_B, BODICE_REPORTED]) {
      for (let backWidth = 300; backWidth <= 400; backWidth += 25) {
        for (let chestWidth = 280; chestWidth <= 400; chestWidth += 20) {
          const measurements = { ...base, back_width: backWidth, chest_width: chestWidth };
          expectArmholesTurnOneWay(expectOk(compiled.evaluate({ measurements })));
        }
      }
    }
  });

  test("each armhole turns one way after a user offset on the back width point or chest point", () => {
    for (const [dx, dy] of [
      [-20, 0],
      [20, 0],
      [0, -20],
      [0, 20],
    ] as const) {
      const offsets = { b_width_pt: { dx, dy }, f_chest: { dx: -dx, dy } };
      expectArmholesTurnOneWay(
        expectOk(compiled.evaluate({ measurements: BODICE_A }, { offsets })),
      );
    }
  });

  // Raised far enough, the back shoulder point lies above the neck point, so the shoulder seam
  // direction wraps past 360 degrees; the right angle to it must still be taken the short way.
  test("each armhole turns one way after a user offset raising a shoulder point", () => {
    const raised = { dx: 0, dy: -60 };
    for (const offsets of [
      { b_shoulder: raised },
      { f_shoulder: raised },
      { b_shoulder: raised, f_shoulder: raised },
    ] as Record<string, UserOffset>[]) {
      for (const [, measurements] of BODICE_SETS) {
        expectArmholesTurnOneWay(expectOk(compiled.evaluate({ measurements }, { offsets })));
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Straight sleeve (ticket 0007), evaluated in a project with the bodice it imports from.

function sleeveText(): string {
  return readFileSync(SLEEVE_PATH, "utf8");
}

function sleeve(): Record<string, unknown> {
  return JSON.parse(sleeveText());
}

/** Arm measurements per bodice test set (the full profile keeps 280, 580 and 160). */
const SLEEVE_ARMS: Record<(typeof BODICE_SETS)[number][0], Measurements> = {
  A: { upper_arm: 280, arm_length: 580, wrist: 160 },
  B: { upper_arm: 300, arm_length: 600, wrist: 170 },
  large: { upper_arm: 340, arm_length: 610, wrist: 185 },
  "low bust": { upper_arm: 320, arm_length: 590, wrist: 175 },
};

const SLEEVE_SETS = BODICE_SETS.map(
  ([label, measurements]) => [label, { ...measurements, ...SLEEVE_ARMS[label] }] as const,
);

const SLEEVE_DEFAULTS = {
  ease_upper_arm: 50,
  ease_wrist: 80,
  length_adjustment: 0,
  cap_ease: 30,
  cap_convex_share: 0.6,
  cap_inflection_tilt: 15,
};

const SLEEVE_IMPORTS = [
  "back_armhole_length",
  "front_armhole_length",
  "back_armhole_to_notch",
  "front_armhole_to_notch",
];

/** The cap curves in outline order: back half from the underarm up to the crown, then the front. */
const CAP = {
  back: ["s_cap_back_lower", "s_cap_back_mid", "s_cap_back_upper"],
  front: ["s_cap_front_upper", "s_cap_front_mid", "s_cap_front_lower"],
} as const;
const CAP_CURVES = [...CAP.back, ...CAP.front];

type SleeveProject = { bodice: ComputedPattern; sleeve: ComputedPattern };

type SleeveOptions = {
  bodice?: Record<string, number>;
  sleeve?: Record<string, number>;
  bodiceDefinition?: unknown;
};

const SLEEVE_PROJECT = compileProject([
  { name: "bodice", definition: bodice() },
  { name: "straight_sleeve", definition: sleeve() },
]);

/** The bodice and sleeve of one project evaluation; both must evaluate without errors. */
function sleeveProject(measurements: Measurements, options: SleeveOptions = {}): SleeveProject {
  const project =
    options.bodiceDefinition === undefined
      ? SLEEVE_PROJECT
      : compileProject([
          { name: "bodice", definition: options.bodiceDefinition },
          { name: "straight_sleeve", definition: sleeve() },
        ]);
  const result = project.evaluate({
    measurements,
    parameters: { bodice: options.bodice ?? {}, straight_sleeve: options.sleeve ?? {} },
  });
  return {
    bodice: expectOk(result.parts.bodice!),
    sleeve: expectOk(result.parts.straight_sleeve!),
  };
}

/** The bodice's armhole values, as the sleeve imports them. */
function armholeImports(bodiceResult: ComputedPattern): Record<string, number> {
  return Object.fromEntries(SLEEVE_IMPORTS.map((name) => [name, bodiceResult.values[name]!]));
}

function capSum(result: ComputedPattern, names: readonly string[]): number {
  return names.reduce((total, name) => total + curveLength(result, name), 0);
}

const POLYLINE_STEPS = 4000;

/** Points along one computed curve, `POLYLINE_STEPS` segments for a cubic, the ends of a line. */
function curvePoints(curve: ComputedCurve): Point[] {
  if (curve.type === "line") return [curve.from, curve.to];
  return Array.from({ length: POLYLINE_STEPS + 1 }, (_, i) =>
    cubicAt(curve.from, curve.c1, curve.c2, curve.to, i / POLYLINE_STEPS),
  );
}

/** A fine polyline through the named curves in order, each junction once. */
function polyline(result: ComputedPattern, names: readonly string[]): Point[] {
  const points: Point[] = [];
  for (const name of names) {
    const curve = result.curves[name];
    if (curve === undefined) throw new Error(`curve ${name} did not compute`);
    points.push(...curvePoints(curve).slice(points.length === 0 ? 0 : 1));
  }
  return points;
}

function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
  return total;
}

/**
 * The arc length (mm) along the polyline from its start to the point on it nearest `target`,
 * measured independently of the engine's arc-length inversion.
 */
function arcLengthTo(points: readonly Point[], target: Point): number {
  let best = { gap: Infinity, along: 0 };
  let along = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = distance(a, b);
    const t =
      length === 0
        ? 0
        : Math.min(
            1,
            Math.max(0, ((target.x - a.x) * (b.x - a.x) + (target.y - a.y) * (b.y - a.y)) / length ** 2),
          );
    const foot = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const gap = distance(foot, target);
    if (gap < best.gap) best = { gap, along: along + length * t };
    along += length;
  }
  expect(best.gap).toBeLessThan(0.01);
  return best.along;
}

/** Samples of the named curves in order, without zero-length curves or repeated points. */
function capSamples(result: ComputedPattern, names: readonly string[]): Point[] {
  const points: Point[] = [];
  for (const name of names) {
    const curve = result.curves[name]!;
    if (curve.length === 0) continue;
    const step = curve.type === "line" ? [curve.from, curve.to] : sampleCubic(curve);
    for (const p of step) {
      const last = points[points.length - 1];
      if (last === undefined || distance(last, p) > 1e-9) points.push(p);
    }
  }
  return points;
}

function sampleCubic(curve: Extract<ComputedCurve, { type: "cubic" }>): Point[] {
  return Array.from({ length: ARMHOLE_SAMPLES + 1 }, (_, i) =>
    cubicAt(curve.from, curve.c1, curve.c2, curve.to, i / ARMHOLE_SAMPLES),
  );
}

/** The direction of travel at the start or end of a computed curve. */
function endDirection(curve: ComputedCurve, end: "start" | "end"): Point {
  if (curve.type === "line") return { x: curve.to.x - curve.from.x, y: curve.to.y - curve.from.y };
  const [a, b] = end === "start" ? [curve.from, curve.c1] : [curve.c2, curve.to];
  return { x: b.x - a.x, y: b.y - a.y };
}

const COS_HALF_DEGREE = Math.cos((0.5 * Math.PI) / 180);
const SIN_HALF_DEGREE = Math.sin((0.5 * Math.PI) / 180);

/** The curve names of the cap halves with non-zero length, in outline order. */
function drawnCap(result: ComputedPattern, names: readonly string[]): string[] {
  return names.filter((name) => curveLength(result, name) > 0);
}

/** The shape checks every cap must pass (see the test plan of ticket 0007). */
function expectSmoothCap(result: ComputedPattern): void {
  const upper = turns(capSamples(result, ["s_cap_back_upper", "s_cap_front_upper"]));
  expect(Math.min(...upper)).toBeGreaterThan(-ARMHOLE_NOISE);
  expect(Math.max(...upper)).toBeGreaterThan(0);
  for (const name of ["s_cap_back_lower", "s_cap_front_lower"]) {
    const lower = turns(capSamples(result, [name]));
    expect(Math.max(...lower)).toBeLessThan(ARMHOLE_NOISE);
    expect(Math.min(...lower)).toBeLessThan(0);
  }
  // One tangent at every junction of the drawn cap curves, the crown included.
  const drawn = drawnCap(result, CAP_CURVES);
  for (let i = 1; i < drawn.length; i++) {
    const incoming = endDirection(result.curves[drawn[i - 1]!]!, "end");
    const outgoing = endDirection(result.curves[drawn[i]!]!, "start");
    const origin = { x: 0, y: 0 };
    expect(cosineBetween(origin, incoming, origin, outgoing)).toBeGreaterThan(COS_HALF_DEGREE);
  }
  // Horizontal at the crown and at both underarm points.
  const height = result.values.cap_height!;
  for (const [name, end] of [
    ["s_cap_back_lower", "start"],
    ["s_cap_back_upper", "end"],
    ["s_cap_front_upper", "start"],
    ["s_cap_front_lower", "end"],
  ] as const) {
    const direction = endDirection(result.curves[name]!, end);
    expect(direction.x).toBeGreaterThan(0);
    expect(Math.abs(direction.y) / Math.hypot(direction.x, direction.y)).toBeLessThan(SIN_HALF_DEGREE);
  }
  // Each half only runs one way across (never overhangs) and stays between crown and underarm.
  for (const names of [CAP.back, CAP.front]) {
    const points = capSamples(result, names);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.x - points[i - 1]!.x).toBeGreaterThan(-ARMHOLE_NOISE);
    }
    for (const p of points) {
      expect(p.y).toBeGreaterThan(-ARMHOLE_NOISE);
      expect(p.y).toBeLessThan(height + ARMHOLE_NOISE);
    }
  }
}

/**
 * The tangent angle (degrees from horizontal) where a cap half turns from convex to concave: the
 * direction of its straight middle, or of the end of its first curve when the middle has no length.
 * `names` is the half in outline order, so the middle is always the second curve.
 */
function inflectionAngle(result: ComputedPattern, names: readonly string[]): number {
  const middle = result.curves[names[1]!]!;
  const direction =
    middle.length > 1e-6
      ? endDirection(middle, "start")
      : endDirection(result.curves[names[0]!]!, "end");
  return (Math.atan2(Math.abs(direction.y), Math.abs(direction.x)) * 180) / Math.PI;
}

/**
 * How far a cap half rises outside the straight guide line from the crown to its underarm point
 * and how deep it hollows inside it (mm), from samples of the drawn curves.
 */
function guideDeviation(
  result: ComputedPattern,
  names: readonly string[],
  underarm: string,
): { rise: number; hollow: number } {
  const crown = point(result, "s_crown");
  const end = point(result, underarm);
  const length = distance(crown, end);
  const side = (p: Point) =>
    ((end.x - crown.x) * (p.y - crown.y) - (end.y - crown.y) * (p.x - crown.x)) / length;
  // The grainline point under the crown lies inside the sleeve.
  const inside = Math.sign(side({ x: crown.x, y: end.y }));
  let rise = 0;
  let hollow = 0;
  for (const p of capSamples(result, names)) {
    const signed = side(p) * inside;
    hollow = Math.max(hollow, signed);
    rise = Math.max(rise, -signed);
  }
  return { rise, hollow };
}

/** The cap halves and their total equal the bodice armholes plus cap ease (AC3). */
function expectCapFits(project: SleeveProject, capEase = SLEEVE_DEFAULTS.cap_ease): void {
  const { bodice: b, sleeve: s } = project;
  expectWithin(capSum(s, CAP_CURVES), b.values.armhole_length! + capEase, 2);
  expectWithin(capSum(s, CAP.back), b.values.back_armhole_length! + capEase / 2, 1);
  expectWithin(capSum(s, CAP.front), b.values.front_armhole_length! + capEase / 2, 1);
}

describe("straight sleeve: definition", () => {
  test("names the block and its drafting source", () => {
    const definition = sleeve();
    expect(definition.version).toBe(1);
    expect(definition.name).toBe("Straight sleeve");
    expect(String(definition.source)).toContain("Aldrich");
    expect(String(definition.source)).not.toContain("not checked");
  });

  test("declares exactly the three arm measurements", () => {
    const measurements = sleeve().measurements as string[];
    expect(measurements).toEqual(["upper_arm", "arm_length", "wrist"]);
    for (const key of measurements) expect(isMeasurementKey(key)).toBe(true);
  });

  test("imports the four armhole values of the bodice under the same names", () => {
    expect(sleeve().imports).toEqual(
      Object.fromEntries(SLEEVE_IMPORTS.map((name) => [name, `bodice.${name}`])),
    );
    // Every value the sleeve imports is part of the bodice's pinned interface.
    for (const name of SLEEVE_IMPORTS) expect(BODICE_INTERFACE).toContain(name);
  });

  test("declares the parameters with their defaults", () => {
    expect(sleeve().parameters).toEqual(SLEEVE_DEFAULTS);
  });

  test("has one piece, the cap halves, the underarm seams and the hem in outline order", () => {
    const definition = sleeve();
    expect((definition.pieces as { name: string }[]).map((p) => p.name)).toEqual(["sleeve"]);
    expect(outlineCurves(definition, "sleeve")).toEqual([
      ...CAP_CURVES,
      "s_seam_front",
      "s_hem",
      "s_seam_back",
    ]);
    const types = curveTypes(definition);
    for (const name of ["s_cap_back_lower", "s_cap_back_upper", "s_cap_front_upper", "s_cap_front_lower"]) {
      expect(types[name]).toBe("cubic");
    }
  });

  test("has a double back notch, a crown notch and a single front notch", () => {
    const [only] = sleeve().pieces as { notches: unknown }[];
    expect(only?.notches).toEqual([
      { curve: "s_cap_back_lower", distance: "back_armhole_to_notch", marks: 2 },
      { curve: "s_cap_front_upper", distance: "0" },
      { curve: "s_cap_front_upper", distance: "front_cap_length - front_armhole_to_notch" },
    ]);
  });
});

for (const [label, measurements] of SLEEVE_SETS) {
  describe(`straight sleeve: measurement set ${label}`, () => {
    const project = sleeveProject(measurements);
    const { bodice: b, sleeve: s } = project;

    test("the cap equals the armhole plus cap ease, each half its own armhole half (AC3)", () => {
      expectCapFits(project);
      expect(s.values.cap_length).toBeCloseTo(capSum(s, CAP_CURVES), 6);
      expect(s.values.back_cap_length).toBeCloseTo(capSum(s, CAP.back), 6);
      expect(s.values.front_cap_length).toBeCloseTo(capSum(s, CAP.front), 6);
      // Back and front armholes differ, and so do the halves.
      expect(Math.abs(b.values.back_armhole_length! - b.values.front_armhole_length!)).toBeGreaterThan(5);
    });

    test("the bicep line is upper arm plus ease wide, at the cap height", () => {
      const back = point(s, "s_underarm_back");
      const front = point(s, "s_underarm_front");
      expectWithin(front.x - back.x, measurements.upper_arm! + SLEEVE_DEFAULTS.ease_upper_arm, 0.01);
      expect(back.y).toBeCloseTo(s.values.cap_height!, 9);
      expect(front.y).toBeCloseTo(s.values.cap_height!, 9);
      expect(point(s, "s_crown")).toEqual({ x: 0, y: 0 });
    });

    test("the hem is wrist plus ease wide, level at the sleeve length, between equal underarm seams", () => {
      const back = point(s, "s_hem_back");
      const front = point(s, "s_hem_front");
      expectWithin(front.x - back.x, measurements.wrist! + SLEEVE_DEFAULTS.ease_wrist, 0.01);
      expect(back.y).toBeCloseTo(measurements.arm_length!, 9);
      expect(front.y).toBeCloseTo(measurements.arm_length!, 9);
      expectWithin(curveLength(s, "s_seam_front"), curveLength(s, "s_seam_back"), 0.01);
    });

    test("the grainline runs straight down through the crown", () => {
      const { grainline } = piece(s, "sleeve");
      expect(grainline.from.x).toBe(0);
      expect(grainline.to.x).toBe(0);
      expect(grainline.to.y).toBeGreaterThan(grainline.from.y);
    });

    test("bodice notches lie on the back width and chest points (AC5)", () => {
      const back = piece(b, "back").notches;
      const front = piece(b, "front").notches;
      expectWithin(distance(back[0]!.point, point(b, "b_width_pt")), 0, 0.01);
      expectWithin(distance(front[0]!.point, point(b, "f_chest")), 0, 0.01);
      expect(back[0]!.marks).toHaveLength(2);
      expect(front[0]!.marks).toHaveLength(1);
    });

    test("sleeve notches lie at the bodice's arc distances from the underarm points (AC5)", () => {
      const [backNotch, crownNotch, frontNotch] = piece(s, "sleeve").notches;
      expect(backNotch!.marks).toHaveLength(2);
      expect(crownNotch!.marks).toHaveLength(1);
      expect(frontNotch!.marks).toHaveLength(1);
      expectWithin(distance(crownNotch!.point, point(s, "s_crown")), 0, 1e-9);

      const backCap = polyline(s, CAP.back);
      const frontCap = polyline(s, CAP.front);
      const backToNotch = arcLengthTo(backCap, backNotch!.point);
      const frontToNotch = polylineLength(frontCap) - arcLengthTo(frontCap, frontNotch!.point);
      expectWithin(backToNotch, b.values.back_armhole_to_notch!, 0.5);
      expectWithin(frontToNotch, b.values.front_armhole_to_notch!, 0.5);

      // All the cap ease lies between the notches.
      const capBetween = polylineLength(backCap) + polylineLength(frontCap) - backToNotch - frontToNotch;
      const armholeBetween =
        b.values.armhole_length! - b.values.back_armhole_to_notch! - b.values.front_armhole_to_notch!;
      expectWithin(capBetween - armholeBetween, SLEEVE_DEFAULTS.cap_ease, 1);
    });

    test("every notch mark ends inside the sleeve", () => {
      const computed = piece(s, "sleeve");
      const polygon = outlinePolygon(computed);
      for (const notch of computed.notches) {
        for (const mark of notch.marks) expect(insidePolygon(polygon, mark.to.x, mark.to.y)).toBe(true);
      }
    });

    test("each cap half is one smooth S: convex above, concave below, horizontal at the ends", () => {
      expectSmoothCap(s);
    });

    test("the label fits in the sleeve", () => {
      expect(placeLabel(piece(s, "sleeve"), "Sleeve", 14)).not.toBeNull();
    });
  });
}

describe("straight sleeve: cap shape", () => {
  // Each half runs diagonally: a convex crown rising above the guide line from the crown to the
  // underarm point, a sloped straight middle crossing it, and a shallower hollow below it.
  for (const [label, measurements] of SLEEVE_SETS) {
    test(`set ${label}: the inflection is sloped and the cap crosses its guide line, upper arm ±20 mm`, () => {
      for (let change = -20; change <= 20; change += 10) {
        const { sleeve: s } = sleeveProject({
          ...measurements,
          upper_arm: measurements.upper_arm! + change,
        });
        for (const [names, underarm] of [
          [CAP.back, "s_underarm_back"],
          [CAP.front, "s_underarm_front"],
        ] as const) {
          const angle = inflectionAngle(s, names);
          const end = point(s, underarm);
          const guide = (Math.atan2(end.y, Math.abs(end.x)) * 180) / Math.PI;
          expect(angle).toBeGreaterThan(35);
          expect(angle).toBeLessThan(70);
          expectWithin(angle - guide, SLEEVE_DEFAULTS.cap_inflection_tilt, 1e-6);
          const { rise, hollow } = guideDeviation(s, names, underarm);
          expect(rise).toBeGreaterThan(10);
          expect(rise).toBeLessThan(35);
          expect(hollow).toBeGreaterThan(5);
          expect(hollow).toBeLessThan(rise);
        }
      }
    });
  }

  test("a larger cap_inflection_tilt makes the inflection steeper and the cap lower, and it still fits", () => {
    const measurements = SLEEVE_SETS[0]![1];
    const base = sleeveProject(measurements);
    const steeper = sleeveProject(measurements, { sleeve: { cap_inflection_tilt: 25 } });
    for (const names of [CAP.back, CAP.front]) {
      expect(inflectionAngle(steeper.sleeve, names)).toBeGreaterThan(
        inflectionAngle(base.sleeve, names) + 5,
      );
    }
    expect(steeper.sleeve.values.cap_height).toBeLessThan(base.sleeve.values.cap_height!);
    expectCapFits(steeper);
    expectSmoothCap(steeper.sleeve);
  });

  test("shape constants out of range give errors, not a looped cap of the wrong length", () => {
    const measurements = SLEEVE_SETS[0]![1];
    const outOfRange: Record<string, number>[] = [
      { cap_convex_share: -0.2 },
      { cap_convex_share: 0 },
      { cap_convex_share: 1 },
      { cap_convex_share: 1.3 },
      { cap_inflection_tilt: 0 },
      { cap_inflection_tilt: -10 },
    ];
    for (const sleeveParameters of outOfRange) {
      const result = SLEEVE_PROJECT.evaluate({
        measurements,
        parameters: { straight_sleeve: sleeveParameters },
      });
      const part = result.parts.straight_sleeve!;
      expect(part.ok).toBe(false);
      // The guard fails (a negative square root, or 0 / 0 at the ends of the range) and every cap
      // point depending on it is left out.
      const guard = (part.ok ? [] : part.errors).find(
        (error) => "name" in error && String(error.name).startsWith("cap_constants"),
      );
      expect(guard).toBeDefined();
      expect(["invalid_result", "division_by_zero"]).toContain(guard!.kind);
      expect(part.pieces.sleeve).toBeUndefined();
    }
  });
});

describe("straight sleeve: width variants", () => {
  test("a slim and a wide sleeve each get a sloped straight middle and still fit and are smooth", () => {
    for (const upperArm of [240, 380]) {
      const project = sleeveProject({ ...SLEEVE_SETS[0]![1], upper_arm: upperArm });
      for (const name of ["s_cap_back_mid", "s_cap_front_mid"]) {
        expect(curveLength(project.sleeve, name)).toBeGreaterThan(50);
        const half = name === "s_cap_back_mid" ? CAP.back : CAP.front;
        expect(inflectionAngle(project.sleeve, half)).toBeLessThan(80);
      }
      expectCapFits(project);
      expectSmoothCap(project.sleeve);
    }
  });

  test("a tilt of at least the chord angle falls back to two arcs with no straight middle", () => {
    const project = sleeveProject(
      { ...SLEEVE_SETS[0]![1], upper_arm: 380 },
      { sleeve: { cap_inflection_tilt: 90 } },
    );
    const s = project.sleeve;
    for (const side of ["back", "front"] as const) {
      expect(s.values[`${side}_chord_angle`]).toBeLessThan(45);
      expect(s.values[`${side}_cap_turn`]).toBeCloseTo(2 * s.values[`${side}_chord_angle`]!, 9);
      expectWithin(curveLength(s, `s_cap_${side}_mid`), 0, 1e-6);
    }
    expectCapFits(project);
    expectSmoothCap(s);
  });

  test("the turn is capped at 90 degrees: a tall cap with a large tilt gets a vertical middle, no overhang", () => {
    const project = sleeveProject(
      { ...SLEEVE_SETS[0]![1], upper_arm: 240 },
      { sleeve: { cap_inflection_tilt: 90 } },
    );
    const s = project.sleeve;
    for (const side of ["back", "front"] as const) {
      expect(s.values[`${side}_chord_angle`]).toBeGreaterThan(45);
      expect(s.values[`${side}_cap_turn`]).toBe(90);
      expect(curveLength(s, `s_cap_${side}_mid`)).toBeGreaterThan(1);
    }
    expectCapFits(project);
    expectSmoothCap(s);
  });

  test("an implausibly wide sleeve (wider than its armhole) gives errors, not a drawing", () => {
    const result = SLEEVE_PROJECT.evaluate({ measurements: { ...SLEEVE_SETS[0]![1], upper_arm: 600 } });
    expect(result.ok).toBe(false);
    const part = result.parts.straight_sleeve!;
    expect(part.ok).toBe(false);
    expect(part.pieces.sleeve).toBeUndefined();
  });
});

describe("straight sleeve: follows the bodice (AC4)", () => {
  const measurements = SLEEVE_SETS[0]![1];
  const base = sleeveProject(measurements);

  test("a deeper armhole makes the cap longer by the same amount", () => {
    const deeper = sleeveProject(measurements, { bodice: { ease_armhole_depth: 30 } });
    expect(deeper.bodice.values.armhole_length).toBeGreaterThan(base.bodice.values.armhole_length! + 5);
    expectCapFits(deeper);
    expectWithin(
      deeper.sleeve.values.cap_length! - base.sleeve.values.cap_length!,
      deeper.bodice.values.armhole_length! - base.bodice.values.armhole_length!,
      2,
    );
  });

  test("a user offset stored on the back width point moves the cap with the armhole", () => {
    const definition = bodice();
    const points = definition.points as { name: string; user_offset?: UserOffset }[];
    points.find((candidate) => candidate.name === "b_width_pt")!.user_offset = { dx: 15, dy: 0 };
    const moved = sleeveProject(measurements, { bodiceDefinition: definition });
    expect(Math.abs(moved.bodice.values.back_armhole_length! - base.bodice.values.back_armhole_length!)).toBeGreaterThan(1);
    expectCapFits(moved);
    expectWithin(
      moved.sleeve.values.cap_length! - base.sleeve.values.cap_length!,
      moved.bodice.values.armhole_length! - base.bodice.values.armhole_length!,
      2,
    );
  });

  test("a bodice copy without an imported value gives the sleeve missing_import", () => {
    const definition = bodice();
    const formulas = definition.formulas as Record<string, string>;
    formulas.back_armhole_len = formulas.back_armhole_length!;
    delete formulas.back_armhole_length;
    formulas.armhole_length = "back_armhole_len + front_armhole_length";
    const result = evaluateProject(
      [
        { name: "bodice", definition },
        { name: "straight_sleeve", definition: sleeve() },
      ],
      { measurements },
    );
    expect(result.parts.bodice?.ok).toBe(true);
    const part = result.parts.straight_sleeve!;
    expect(part.ok).toBe(false);
    expect(part.ok ? [] : part.errors).toContainEqual(
      expect.objectContaining({
        kind: "missing_import",
        name: "back_armhole_length",
        reference: "bodice.back_armhole_length",
      }),
    );
    expect(part.pieces.sleeve).toBeUndefined();
  });

  test("without a bodice part the sleeve reports every import missing", () => {
    const result = evaluateProject([{ name: "straight_sleeve", definition: sleeve() }], { measurements });
    const part = result.parts.straight_sleeve!;
    const missing = (part.ok ? [] : part.errors).filter((error) => error.kind === "missing_import");
    expect(missing.map((error) => ("name" in error ? error.name : ""))).toEqual(SLEEVE_IMPORTS);
  });
});

describe("straight sleeve: cap solve and sensitivity", () => {
  test("the cap height changes by under 1 mm per mm of armhole and under 0.75 mm per mm of upper arm", () => {
    for (const [, measurements] of SLEEVE_SETS) {
      const at = (ease: number, upperArm: number) =>
        sleeveProject(
          { ...measurements, upper_arm: upperArm },
          { bodice: { ease_armhole_depth: ease } },
        );
      const low = at(0, measurements.upper_arm!);
      const high = at(20, measurements.upper_arm!);
      const perArmhole =
        Math.abs(high.sleeve.values.cap_height! - low.sleeve.values.cap_height!) /
        Math.abs(high.bodice.values.armhole_length! - low.bodice.values.armhole_length!);
      expect(perArmhole).toBeLessThan(1);
      const narrow = at(10, measurements.upper_arm! - 10);
      const wide = at(10, measurements.upper_arm! + 10);
      const perUpperArm =
        Math.abs(wide.sleeve.values.cap_height! - narrow.sleeve.values.cap_height!) / 20;
      expect(perUpperArm).toBeLessThan(0.75);
    }
  });

  test("cap_convex_share 0.5 and 0.7 change the cap length by under 0.2 mm", () => {
    for (const [, measurements] of SLEEVE_SETS) {
      const base = sleeveProject(measurements).sleeve.values.cap_length!;
      for (const share of [0.5, 0.7]) {
        const other = sleeveProject(measurements, { sleeve: { cap_convex_share: share } });
        expectWithin(other.sleeve.values.cap_length!, base, 0.2);
        expectSmoothCap(other.sleeve);
      }
    }
  });

  test("cap_ease adds its change to the cap length", () => {
    for (const [, measurements] of SLEEVE_SETS) {
      const base = sleeveProject(measurements).sleeve.values.cap_length!;
      const more = sleeveProject(measurements, { sleeve: { cap_ease: 40 } });
      expectWithin(more.sleeve.values.cap_length! - base, 10, 0.2);
      expectCapFits(more, 40);
    }
  });

  test("each half is within 0.05 mm of its target over upper arms 240 to 380 mm", () => {
    const compiled = compilePattern(sleeve());
    let evaluated = 0;
    for (const [label, measurements] of SLEEVE_SETS) {
      const imports = armholeImports(sleeveProject(measurements).bodice);
      for (let upperArm = 240; upperArm <= 380; upperArm += 10) {
        const result = compiled.evaluate({
          measurements: { ...SLEEVE_ARMS[label], upper_arm: upperArm },
          imports,
        });
        if (!result.ok) continue;
        evaluated++;
        const { values } = result;
        expectWithin(capSum(result, CAP.back), values.back_cap_target!, 0.05);
        expectWithin(capSum(result, CAP.front), values.front_cap_target!, 0.05);
      }
    }
    // The whole sweep is plausible, so every combination evaluates.
    expect(evaluated).toBe(SLEEVE_SETS.length * 15);
  });
});
