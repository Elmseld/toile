import { describe, expect, test } from "bun:test";
import type { Bounds } from "../geometry/svg";
import type { Point } from "../geometry/vector";
import { MAX_PRINT_TILES, PRINT_MARGIN, TILE_OVERLAP } from "./paper";
import { printedTiles, type TileGrid, tileGrid, tileLabel, tileRect } from "./tiles";

const AREA_WIDTH = 210 - 2 * PRINT_MARGIN; // 190 on A4
const STEP_X = AREA_WIDTH - TILE_OVERLAP; // 180

const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  minX,
  minY,
  maxX,
  maxY,
});

const rectangle = (minX: number, minY: number, maxX: number, maxY: number): Point[] => [
  { x: minX, y: minY },
  { x: maxX, y: minY },
  { x: maxX, y: maxY },
  { x: minX, y: maxY },
];

function grid(bounds: Bounds, paper: "a4" | "letter" = "a4"): TileGrid {
  const result = tileGrid(bounds, paper);
  if (result === null) throw new Error("no grid");
  return result;
}

describe("tileLabel", () => {
  test("gives the row as spreadsheet letters and the column from 1", () => {
    expect(tileLabel(0, 0)).toBe("A1");
    expect(tileLabel(1, 2)).toBe("B3");
    expect(tileLabel(25, 9)).toBe("Z10");
    expect(tileLabel(26, 0)).toBe("AA1");
    expect(tileLabel(51, 0)).toBe("AZ1");
    expect(tileLabel(52, 0)).toBe("BA1");
  });
});

describe("tileGrid", () => {
  test("is one page for a box that fits the printable area", () => {
    const result = grid(box(0, 0, 150, 200));
    expect([result.rows, result.cols]).toEqual([1, 1]);
    expect(result.area).toEqual({ width: 190, height: 277 });
    expect(result.step).toEqual({ x: 180, y: 267 });
  });

  test("adds a column as soon as the box is wider than the area", () => {
    expect(grid(box(0, 0, 190, 10)).cols).toBe(1);
    expect(grid(box(0, 0, 190.1, 10)).cols).toBe(2);
  });

  test("covers a box exactly one step wider than the area with two columns", () => {
    expect(grid(box(10, 0, 10 + AREA_WIDTH + STEP_X, 10)).cols).toBe(2);
    expect(grid(box(10, 0, 10 + AREA_WIDTH + STEP_X + 1, 10)).cols).toBe(3);
  });

  test("is centred on the box", () => {
    const bounds = box(-40, 15, 260, 400);
    const result = grid(bounds);
    const coveredX = (result.cols - 1) * result.step.x + result.area.width;
    const coveredY = (result.rows - 1) * result.step.y + result.area.height;
    expect(bounds.minX - result.origin.x).toBeCloseTo(result.origin.x + coveredX - bounds.maxX, 9);
    expect(bounds.minY - result.origin.y).toBeCloseTo(result.origin.y + coveredY - bounds.maxY, 9);
    expect(result.origin.x).toBeLessThanOrEqual(bounds.minX);
  });

  test("uses Letter's printable area", () => {
    const result = grid(box(0, 0, 10, 10), "letter");
    expect(result.area.width).toBeCloseTo(195.9, 9);
    expect(result.area.height).toBeCloseTo(259.4, 9);
    expect(result.paper).toBe("letter");
  });

  test("gives no grid over MAX_PRINT_TILES cells, without slow work", () => {
    const start = performance.now();
    expect(tileGrid(box(0, 0, 1e7, 1e7), "a4")).toBeNull();
    expect(tileGrid(box(0, 0, 1e300, 10), "a4")).toBeNull();
    expect(performance.now() - start).toBeLessThan(50);
    // Exactly at the cap is fine: 400 columns in one row.
    expect(grid(box(0, 0, AREA_WIDTH + (MAX_PRINT_TILES - 1) * STEP_X, 10)).cols).toBe(400);
    expect(tileGrid(box(0, 0, AREA_WIDTH + MAX_PRINT_TILES * STEP_X, 10), "a4")).toBeNull();
  });

  test("gives no grid for non-finite or inverted bounds", () => {
    expect(tileGrid(box(0, 0, Infinity, 10), "a4")).toBeNull();
    expect(tileGrid(box(Number.NaN, 0, 10, 10), "a4")).toBeNull();
    expect(tileGrid(box(10, 0, 0, 10), "a4")).toBeNull();
  });
});

describe("tileRect", () => {
  test("overlaps the next tile by TILE_OVERLAP each way", () => {
    const result = grid(box(0, 0, 500, 600));
    expect(tileRect(result, 0, 1).minX - tileRect(result, 0, 0).maxX).toBeCloseTo(-TILE_OVERLAP, 9);
    expect(tileRect(result, 1, 0).minY - tileRect(result, 0, 0).maxY).toBeCloseTo(-TILE_OVERLAP, 9);
    expect(tileRect(result, 0, 0)).toEqual({
      minX: result.origin.x,
      minY: result.origin.y,
      maxX: result.origin.x + 190,
      maxY: result.origin.y + 277,
    });
  });
});

describe("printedTiles", () => {
  test("leaves out the cell only the layout box covers", () => {
    // An L of two rectangles: a wide one along the top and a tall one down the left side.
    const top = rectangle(0, 0, 360, 100);
    const left = rectangle(0, 120, 100, 500);
    const result = grid(box(0, 0, 360, 500));
    expect([result.rows, result.cols]).toEqual([2, 2]);
    const labels = printedTiles(result, [top, left]).map((tile) => tile.label);
    expect(labels).toEqual(["A1", "A2", "B1"]);
  });

  test("counts a region that contains the whole tile", () => {
    const result = grid(box(0, 0, 100, 100));
    const huge = rectangle(-1000, -1000, 1000, 1000);
    expect(printedTiles(result, [huge]).map((tile) => tile.label)).toEqual(["A1"]);
  });

  test("counts nothing for a region that touches no tile, or for none", () => {
    const result = grid(box(0, 0, 100, 100));
    expect(printedTiles(result, [rectangle(5000, 5000, 5100, 5100)])).toEqual([]);
    expect(printedTiles(result, [[]])).toEqual([]);
    expect(printedTiles(result, [])).toEqual([]);
  });

  test("lists the tiles row by row, left to right, with their rects", () => {
    const result = grid(box(0, 0, 500, 600));
    const tiles = printedTiles(result, [rectangle(0, 0, 500, 600)]);
    expect(tiles.map((tile) => [tile.row, tile.col])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
    expect(tiles[4]!.rect).toEqual(tileRect(result, 1, 1));
    expect(tiles[4]!.label).toBe("B2");
  });
});
