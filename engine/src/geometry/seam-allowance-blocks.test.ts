import { describe, expect, test } from "bun:test";
import { ARM_MEASUREMENTS, blockFiles, PROFILES, readBlock } from "../../test/support/blocks";
import { evaluatePattern } from "./evaluate";
import { cuttingLineNotches, NOTCH_LENGTH } from "./notches";
import { polygonArea } from "./offset";
import { evaluateProject } from "./project";
import {
  type CuttingPiece,
  cuttingLine,
  pieceSeamAllowances,
  type SeamAllowances,
} from "./seam-allowance";
import type { ComputedPiece } from "./types";
import { distance, type Point, pointSegmentDistance } from "./vector";

// Smoothness and orientation checks of the cutting line of the real blocks over the whole line,
// dart peaks included (seam-allowance.test.ts excludes the dart zones from its distance checks).

const ALLOWANCES = [5, 10, 15, 25];

function piecesOf(block: string, measurements: Record<string, number>): [string, CuttingPiece][] {
  const result = evaluatePattern(readBlock(block), { measurements });
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
    const [, piece] = piecesOf("bodice", PROFILES.medium).find(([name]) => name === "front")!;
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

describe("no jog next to the dart peak", () => {
  // The skirt back's waist is untrued: the closed dart leaves a 25 degree bend next to the dart
  // leg, 0.1 x allowance before the crossing with the leg. Reflected with the flap, that bend
  // would make a jog next to the peak; the construction moves it onto the fold (DART_BEND_SNAP).
  for (const [profile, measurements] of Object.entries(PROFILES)) {
    for (const a of [...ALLOWANCES, 40]) {
      test(`the skirt back at ${profile}, allowance ${a}: no jog next to the dart peak`, () => {
        const piece = piecesOf("straight_skirt", measurements).find(([n]) => n === "back")![1];
        const sign = Math.sign(polygonArea(piece.outline.map((edge) => edge.from)));
        expect(jogs(lineOf(piece, { default: a }), sign, a)).toEqual([]);
      });
    }
  }

  test("the jog detector finds nothing on the other block pieces", () => {
    for (const [block, measurements] of [
      ["straight_skirt", PROFILES.medium],
      ["bodice", PROFILES.medium],
    ] as const) {
      for (const [name, piece] of piecesOf(block, measurements)) {
        if (block === "straight_skirt" && name === "back") continue;
        const sign = Math.sign(polygonArea(piece.outline.map((edge) => edge.from)));
        expect(jogs(lineOf(piece, { default: 15 }), sign, 15)).toEqual([]);
      }
    }
  });
});

/** Every piece of every block, evaluated in one project, by `<block>.<piece>`. */
function allBlockPieces(measurements: Record<string, number>): [string, ComputedPiece][] {
  const parts = blockFiles().map((file) => {
    const name = file.replace(/\.json$/, "");
    return { name, definition: readBlock(name) };
  });
  const project = evaluateProject(parts, {
    measurements: { ...measurements, ...ARM_MEASUREMENTS },
  });
  expect(project.ok).toBe(true);
  return Object.entries(project.parts).flatMap(([block, part]) =>
    Object.values(part.pieces).map((piece): [string, ComputedPiece] => [
      `${block}.${piece.name}`,
      piece,
    ]),
  );
}

/** The distance from `point` to the nearest segment of the closed polygon `line`. */
function lineDistance(line: readonly Point[], point: Point): number {
  return Math.min(
    ...line.map((a, i) => pointSegmentDistance(point, a, line[(i + 1) % line.length]!)),
  );
}

describe("the blocks with their markings (ADR 0011)", () => {
  for (const [profile, measurements] of Object.entries(PROFILES)) {
    test(`${profile}: every piece gets a line, on its fold edges, with its notches on the line`, () => {
      const pieces = allBlockPieces(measurements);
      expect(pieces.map(([name]) => name).sort()).toEqual([
        "bodice.back",
        "bodice.front",
        "straight_skirt.back",
        "straight_skirt.front",
        "straight_sleeve.sleeve",
      ]);
      for (const [, piece] of pieces) {
        const line = lineOf(piece, pieceSeamAllowances(piece, 10));
        for (const fold of piece.folds) {
          const edge = piece.outline.find((curve) => curve.name === fold)!;
          expect(lineDistance(line, edge.from)).toBeLessThan(1e-6);
          expect(lineDistance(line, edge.to)).toBeLessThan(1e-6);
        }
        expect(piece.notches.length).toBeGreaterThan(0);
        const moved = cuttingLineNotches(piece.notches, line);
        expect(moved).toHaveLength(piece.notches.length);
        for (const notch of moved) {
          expect(lineDistance(line, notch.point)).toBeLessThan(0.05);
          for (const mark of notch.marks) {
            expect(lineDistance(line, mark.from)).toBeLessThan(0.05);
            expect(distance(mark.from, mark.to)).toBeCloseTo(NOTCH_LENGTH, 9);
          }
        }
      }
    });
  }
});
