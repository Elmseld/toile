import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluatePattern } from "./evaluate";
import { polygonArea } from "./offset";
import { type CuttingPiece, cuttingLine, type SeamAllowances } from "./seam-allowance";
import { distance, type Point } from "./vector";

// Smoothness and orientation checks of the cutting line of the real blocks over the whole line,
// dart peaks included (seam-allowance.test.ts excludes the dart zones from its distance checks).

const BLOCKS_DIR = join(import.meta.dir, "..", "..", "blocks");

// prettier-ignore
const PROFILES: Record<string, Record<string, number>> = {
  small: {
    bust: 820, waist: 640, hip: 880, neck: 350, shoulder_width: 118, back_width: 330,
    chest_width: 310, back_length: 400, armhole_depth: 200, front_length: 430, bust_height: 255,
    bust_distance: 180, hip_height: 200, skirt_length: 550,
  },
  medium: {
    bust: 880, waist: 680, hip: 940, neck: 370, shoulder_width: 122, back_width: 344,
    chest_width: 324, back_length: 410, armhole_depth: 210, front_length: 445, bust_height: 265,
    bust_distance: 190, hip_height: 206, skirt_length: 600,
  },
  large: {
    bust: 1080, waist: 900, hip: 1140, neck: 410, shoulder_width: 130, back_width: 390,
    chest_width: 370, back_length: 430, armhole_depth: 235, front_length: 490, bust_height: 300,
    bust_distance: 220, hip_height: 220, skirt_length: 700,
  },
};

const ALLOWANCES = [5, 10, 15, 25];

function piecesOf(block: string, measurements: Record<string, number>): [string, CuttingPiece][] {
  const definition = JSON.parse(readFileSync(join(BLOCKS_DIR, `${block}.json`), "utf8"));
  const result = evaluatePattern(definition, { measurements });
  expect(result.ok).toBe(true);
  return Object.entries(result.pieces);
}

function lineOf(piece: CuttingPiece, allowances: SeamAllowances): Point[] {
  const result = cuttingLine(piece, allowances);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.points;
}

/** Turning (degrees, positive = the outline's own direction) at point `i` of the closed line. */
function turnAt(points: readonly Point[], i: number, sign: number): number {
  const n = points.length;
  const a = points[(i + n - 1) % n]!;
  const b = points[i]!;
  const c = points[(i + 1) % n]!;
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  return ((Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI) * sign;
}

/** Short segments between two sharp turns of opposite sense: a visible jog in a cut edge. */
function jogs(points: readonly Point[], sign: number, allowance: number): Point[] {
  const found: Point[] = [];
  points.forEach((point, i) => {
    const next = points[(i + 1) % points.length]!;
    const before = turnAt(points, i, sign);
    const after = turnAt(points, (i + 1) % points.length, sign);
    if (before * after < 0 && Math.abs(before) > 10 && Math.abs(after) > 10) {
      if (distance(point, next) < 0.15 * allowance) found.push(point);
    }
  });
  return found;
}

describe("cutting line of the blocks over the whole line", () => {
  for (const block of ["straight_skirt", "bodice"]) {
    for (const [profile, measurements] of Object.entries(PROFILES)) {
      for (const a of ALLOWANCES) {
        test(`${block} at ${profile}, allowance ${a}: no tiny segments, none sharper than a corner`, () => {
          for (const [, piece] of piecesOf(block, measurements)) {
            const line = lineOf(piece, { default: a });
            const sign = Math.sign(polygonArea(piece.outline.map((edge) => edge.from)));
            line.forEach((point, i) => {
              // No two consecutive points closer than a micron-scale duplicate would be.
              expect(distance(point, line[(i + 1) % line.length]!)).toBeGreaterThan(1e-3);
            });
            // The sharpest corner of the blocks turns by about 110 degrees (a miter, never a
            // hairpin or a loop).
            line.forEach((_, i) => {
              expect(Math.abs(turnAt(line, i, sign))).toBeLessThan(120);
            });
          }
        });
      }
    }
  }

  test("reversing the outline direction gives the same cutting line on a real piece", () => {
    const [, piece] = piecesOf("bodice", PROFILES.medium!).find(([name]) => name === "front")!;
    const reversed: CuttingPiece = {
      outline: [...piece.outline].reverse().map((edge) =>
        edge.type === "line"
          ? { ...edge, from: edge.to, to: edge.from }
          : { ...edge, from: edge.to, c1: edge.c2, c2: edge.c1, to: edge.from },
      ),
    };
    const forward = lineOf(piece, { default: 12 });
    const backward = lineOf(reversed, { default: 12 });
    // Every point of one line is on the other (the dart press direction depends on the order, so
    // the dart zones are allowed to differ; the rest must agree).
    const near = (line: readonly Point[], point: Point): number =>
      Math.min(...line.map((q) => distance(q, point)));
    const legs = piece.outline.filter((edge) => /dart_leg/.test(edge.name));
    const dartPoints = legs.flatMap((edge) => [edge.from, edge.to]);
    let compared = 0;
    for (const point of forward) {
      if (dartPoints.some((end) => distance(end, point) < 60)) continue;
      expect(near(backward, point)).toBeLessThan(0.5);
      compared++;
    }
    expect(compared).toBeGreaterThan(50);
  });
});

describe("known visual defects of the dart peak", () => {
  // The skirt back's waist is untrued: the closed dart leaves a 25 degree bend next to the
  // dart leg, 0.1 x allowance before the crossing with the leg. The flap reflects that bend into
  // a jog (about 0.02 x allowance deep) next to the peak. These tests document that; when the
  // jog is removed they start passing and `test.failing` makes them fail: change them to `test`.
  for (const [profile, measurements] of Object.entries(PROFILES)) {
    test.failing(`the skirt back cutting line has no jog next to the dart peak at ${profile}`, () => {
      const piece = piecesOf("straight_skirt", measurements).find(([n]) => n === "back")![1];
      const sign = Math.sign(polygonArea(piece.outline.map((edge) => edge.from)));
      expect(jogs(lineOf(piece, { default: 15 }), sign, 15)).toEqual([]);
    });
  }

  test("the jog detector finds nothing on the other block pieces", () => {
    for (const [block, measurements] of [
      ["straight_skirt", PROFILES.medium!],
      ["bodice", PROFILES.medium!],
    ] as const) {
      for (const [name, piece] of piecesOf(block, measurements)) {
        if (block === "straight_skirt" && name === "back") continue;
        const sign = Math.sign(polygonArea(piece.outline.map((edge) => edge.from)));
        expect(jogs(lineOf(piece, { default: 15 }), sign, 15)).toEqual([]);
      }
    }
  });
});
