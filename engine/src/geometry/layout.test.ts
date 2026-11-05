import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluatePattern } from "./evaluate";
import { layoutParts, layoutPieces, PART_GAP, PIECE_GAP, pointPieces, shiftCurve } from "./layout";
import { evaluateProject } from "./project";
import {
  cuttingLine,
  DEFAULT_SEAM_ALLOWANCE,
  MAX_SEAM_ALLOWANCE,
  pieceSeamAllowances,
} from "./seam-allowance";
import { patternBounds } from "./svg";
import type { PatternResult } from "./types";

describe("layoutParts", () => {
  test("places parts side by side, PART_GAP apart, tops aligned with the first", () => {
    expect(PART_GAP).toBe(50);
    const layout = layoutParts([
      { minX: 0, minY: -20, maxX: 500, maxY: 400 },
      { minX: -200, minY: 0, maxX: 200, maxY: 600 },
    ]);
    expect(layout.offsets).toEqual([
      { dx: 0, dy: 0 },
      { dx: 750, dy: -20 },
    ]);
    expect(layout.bounds).toEqual({ minX: 0, minY: -20, maxX: 950, maxY: 580 });
  });

  test("a part without bounds gets no offset and takes no room", () => {
    const layout = layoutParts(
      [null, { minX: 10, minY: 10, maxX: 20, maxY: 20 }, null, { minX: 0, minY: 0, maxX: 5, maxY: 5 }],
      10,
    );
    expect(layout.offsets).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 30, dy: 10 },
    ]);
    expect(layout.bounds).toEqual({ minX: 10, minY: 10, maxX: 35, maxY: 20 });
  });

  test("no parts, or none with bounds, gives bounds null", () => {
    expect(layoutParts([])).toEqual({ offsets: [], bounds: null });
    expect(layoutParts([null])).toEqual({ offsets: [{ dx: 0, dy: 0 }], bounds: null });
  });
});

describe("layoutPieces", () => {
  test("pieces with room enough stay where the definition puts them", () => {
    expect(PIECE_GAP).toBe(20);
    const layout = layoutPieces([
      { minX: 0, minY: 0, maxX: 100, maxY: 300 },
      { minX: 120, minY: 0, maxX: 220, maxY: 300 },
    ]);
    expect(layout.offsets).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
    expect(layout.bounds).toEqual({ minX: 0, minY: 0, maxX: 220, maxY: 300 });
  });

  test("a piece too close to one on its left moves right to PIECE_GAP from it", () => {
    // Given right to left: the order is by left edge, not by the given order.
    const layout = layoutPieces([
      { minX: 90, minY: 10, maxX: 200, maxY: 310 },
      { minX: -10, minY: 0, maxX: 110, maxY: 300 },
    ]);
    expect(layout.offsets).toEqual([
      { dx: 40, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
    expect(layout.bounds).toEqual({ minX: -10, minY: 0, maxX: 240, maxY: 310 });
  });

  test("a piece moves past every piece before it that it shares rows with", () => {
    const layout = layoutPieces(
      [
        { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        { minX: 0, minY: 200, maxX: 300, maxY: 300 },
        { minX: 50, minY: 50, maxX: 150, maxY: 250 },
      ],
      10,
    );
    // Overlaps both rows: past the wider one.
    expect(layout.offsets[2]).toEqual({ dx: 260, dy: 0 });
    // The second is 100 below the first: more than the gap, so it stays.
    expect(layout.offsets[1]).toEqual({ dx: 0, dy: 0 });
  });

  test("pieces closer than the gap vertically count as sharing a row", () => {
    const layout = layoutPieces(
      [
        { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        { minX: 0, minY: 105, maxX: 100, maxY: 200 },
      ],
      10,
    );
    expect(layout.offsets[1]).toEqual({ dx: 110, dy: 0 });
  });

  test("a piece without bounds gets no offset and takes no room; none gives bounds null", () => {
    const layout = layoutPieces([null, { minX: 0, minY: 0, maxX: 5, maxY: 5 }]);
    expect(layout).toEqual({
      offsets: [
        { dx: 0, dy: 0 },
        { dx: 0, dy: 0 },
      ],
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    });
    expect(layoutPieces([])).toEqual({ offsets: [], bounds: null });
    expect(layoutPieces([null])).toEqual({ offsets: [{ dx: 0, dy: 0 }], bounds: null });
  });

  // The skirt's front and back are drawn a fixed 50 mm apart, so their cutting lines met at a
  // default of 2.5 cm and overlapped above it (Copilot review of ticket 0015).
  test("the cutting lines of the pieces of every block stay apart at every allowance", () => {
    for (const [block, part] of blockParts()) {
      for (const allowance of [0, DEFAULT_SEAM_ALLOWANCE, 30, 60, MAX_SEAM_ALLOWANCE]) {
        const pieces = Object.values(part.pieces);
        const boxes = pieces.map((piece) => {
          const line = cuttingLine(piece, pieceSeamAllowances(piece, allowance, undefined));
          if (!line.ok) throw new Error(`${block}.${piece.name} at ${allowance}`);
          return patternBounds({ pieces: { [piece.name]: piece } }, [line.points]);
        });
        const layout = layoutPieces(boxes);
        const moved = boxes.map((box, i) => {
          const { dx, dy } = layout.offsets[i]!;
          return {
            minX: box!.minX + dx,
            minY: box!.minY + dy,
            maxX: box!.maxX + dx,
            maxY: box!.maxY + dy,
          };
        });
        for (const [i, a] of moved.entries()) {
          for (const b of moved.slice(i + 1)) {
            const apartX = Math.max(b.minX - a.maxX, a.minX - b.maxX);
            const apartY = Math.max(b.minY - a.maxY, a.minY - b.maxY);
            expect(Math.max(apartX, apartY)).toBeGreaterThanOrEqual(PIECE_GAP - 1e-9);
          }
        }
        expect(layout.bounds).toEqual({
          minX: Math.min(...moved.map((box) => box.minX)),
          minY: Math.min(...moved.map((box) => box.minY)),
          maxX: Math.max(...moved.map((box) => box.maxX)),
          maxY: Math.max(...moved.map((box) => box.maxY)),
        });
      }
    }
  });
});

describe("pointPieces", () => {
  test("a point goes with the first piece that uses it, else with the nearest piece", () => {
    const at = (name: string, x: number, y: number) =>
      name === "a"
        ? { name, op: "start", x: "0", y: "0" }
        : { name, op: "offset", from: "a", dx: String(x), dy: String(y) };
    const line = (from: string, to: string) => ({ name: from + to, type: "line", from, to });
    const piece = (name: string, curves: string[], from: string, to: string) => ({
      name,
      outline: curves.map((curve) => ({ curve })),
      grainline: { from, to },
    });
    const result = evaluatePattern(
      {
        version: 1,
        points: [
          at("a", 0, 0),
          at("b", 100, 0),
          at("c", 100, 100),
          at("d", 300, 0),
          at("e", 400, 0),
          at("f", 400, 100),
          at("near_right", 350, 300),
          at("near_left", 150, 50),
        ],
        curves: [
          line("a", "b"),
          line("b", "c"),
          line("c", "a"),
          line("d", "e"),
          line("e", "f"),
          line("f", "d"),
          line("b", "d"),
          line("e", "b"),
        ],
        // `shared` uses b, which `left` has, and d and e, which `right` has.
        pieces: [
          piece("left", ["ab", "bc", "ca"], "a", "c"),
          piece("right", ["de", "ef", "fd"], "d", "f"),
          piece("shared", ["bd", "de", "eb"], "b", "d"),
        ],
      },
      { measurements: {} },
    );
    expect(result.ok).toBe(true);
    expect(Object.fromEntries(pointPieces(result))).toEqual({
      a: "left",
      b: "left",
      c: "left",
      d: "right",
      e: "right",
      f: "right",
      near_right: "right",
      near_left: "left",
    });
  });

  test("without pieces, or with a point that is not finite, those points are left out", () => {
    expect(pointPieces({ points: { a: { x: 1, y: 2 } }, pieces: {} }).size).toBe(0);
    const p = { x: 0, y: 0 };
    const q = { x: 10, y: 0 };
    const owners = pointPieces({
      points: { p, q, lost: { x: Number.NaN, y: 0 } },
      pieces: {
        only: {
          name: "only",
          outline: [{ name: "pq", type: "line", from: p, to: q, length: 10 }],
          grainline: { from: p, to: q },
          notches: [],
          folds: [],
        },
      },
    });
    expect(Object.fromEntries(owners)).toEqual({ p: "only", q: "only" });
  });
});

describe("shiftCurve", () => {
  test("moves every point of a line or a cubic and keeps the rest", () => {
    const line = {
      name: "l",
      type: "line",
      from: { x: 0, y: 0 },
      to: { x: 1, y: 2 },
      length: 3,
    } as const;
    expect(shiftCurve(line, 10, -1)).toEqual({
      ...line,
      from: { x: 10, y: -1 },
      to: { x: 11, y: 1 },
    });
    const cubic = {
      name: "c",
      type: "cubic",
      from: { x: 0, y: 0 },
      c1: { x: 1, y: 0 },
      c2: { x: 2, y: 1 },
      to: { x: 3, y: 3 },
      length: 5,
    } as const;
    expect(shiftCurve(cubic, 1, 1)).toEqual({
      ...cubic,
      from: { x: 1, y: 1 },
      c1: { x: 2, y: 1 },
      c2: { x: 3, y: 2 },
      to: { x: 4, y: 4 },
    });
  });
});

/** Every block evaluated in one project, by block name. */
function blockParts(): [string, PatternResult][] {
  const dir = join(import.meta.dir, "..", "..", "blocks");
  const parts = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      name: file.replace(/\.json$/, ""),
      definition: JSON.parse(readFileSync(join(dir, file), "utf8")),
    }));
  // prettier-ignore
  const measurements = {
    bust: 880, waist: 680, hip: 940, neck: 370, shoulder_width: 122, back_width: 344,
    chest_width: 324, back_length: 410, armhole_depth: 210, front_length: 445, bust_height: 265,
    bust_distance: 190, hip_height: 206, skirt_length: 600, arm_length: 580, upper_arm: 280,
    wrist: 160,
  };
  const project = evaluateProject(parts, { measurements });
  expect(project.ok).toBe(true);
  return Object.entries(project.parts);
}
