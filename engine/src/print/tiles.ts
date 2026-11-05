// The tile grid of a printed pattern (docs/adr/0012-pdf-printing.md): pages of the printable area
// of the paper, overlapping by TILE_OVERLAP, centred on the layout box, and which of them have
// some of the pattern on them. Pattern coordinates in mm (SVG: y down).

import { insidePolygon, rectSegmentDistance } from "../geometry/label";
import type { Bounds } from "../geometry/svg";
import type { Point } from "../geometry/vector";
import { MAX_PRINT_TILES, PAPER_SIZES, type Paper, PRINT_MARGIN, TILE_OVERLAP } from "./paper";

/** Rows and columns of tile pages over a layout box. */
export type TileGrid = {
  paper: Paper;
  /** Pattern coordinates (mm) of the top left of tile A1's printable area. */
  origin: Point;
  /** The printable area of a page (mm): the paper less PRINT_MARGIN on every side. */
  area: { width: number; height: number };
  /** The distance (mm) between the printable areas of neighbouring tiles: area − TILE_OVERLAP. */
  step: { x: number; y: number };
  rows: number;
  cols: number;
};

/** One tile page: its 0-based grid position, its label ("B3") and its printable area in mm. */
export type Tile = { row: number; col: number; label: string; rect: Bounds };

// Counts within this of a whole number are that number, so a box exactly n steps wide gets no
// extra column from rounding.
const COUNT_TOLERANCE = 1e-9;

/**
 * The fewest rows and columns of tiles of `paper` that cover `bounds`, centred on it. `null` when
 * the grid would have more than MAX_PRINT_TILES cells or `bounds` is not finite; the counts are
 * checked before any per-tile work.
 */
export function tileGrid(bounds: Bounds, paper: Paper): TileGrid | null {
  const { minX, minY, maxX, maxY } = bounds;
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX < minX || maxY < minY) return null;
  const size = PAPER_SIZES[paper];
  const area = { width: size.width - 2 * PRINT_MARGIN, height: size.height - 2 * PRINT_MARGIN };
  const step = { x: area.width - TILE_OVERLAP, y: area.height - TILE_OVERLAP };
  const width = maxX - minX;
  const height = maxY - minY;
  const cols = tileCount(width, area.width, step.x);
  const rows = tileCount(height, area.height, step.y);
  if (!Number.isFinite(cols * rows) || cols * rows > MAX_PRINT_TILES) return null;
  const covered = { x: (cols - 1) * step.x + area.width, y: (rows - 1) * step.y + area.height };
  return {
    paper,
    origin: { x: minX - (covered.x - width) / 2, y: minY - (covered.y - height) / 2 },
    area,
    step,
    rows,
    cols,
  };
}

/** The tiles along one axis: one if it fits, else enough steps after the first to cover it. */
function tileCount(length: number, area: number, step: number): number {
  if (length <= area) return 1;
  return Math.ceil((length - area) / step - COUNT_TOLERANCE) + 1;
}

/**
 * The label of the tile at 0-based `row` and `col`: the row as letters, spreadsheet style (A to Z,
 * then AA), and the column as a number from 1. `(0, 0)` is "A1", `(1, 2)` "B3", `(26, 0)` "AA1".
 */
export function tileLabel(row: number, col: number): string {
  let letters = "";
  for (let n = row + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return `${letters}${col + 1}`;
}

/** The printable area (pattern mm) of the tile at `row`, `col`. */
export function tileRect(grid: TileGrid, row: number, col: number): Bounds {
  const minX = grid.origin.x + col * grid.step.x;
  const minY = grid.origin.y + row * grid.step.y;
  return { minX, minY, maxX: minX + grid.area.width, maxY: minY + grid.area.height };
}

/**
 * The tiles of `grid` that some region overlaps, row by row and left to right. A region is a
 * closed polygon (last point not repeated), such as a piece's cutting line. It overlaps a tile
 * when one of its edges meets the tile's printable area, or when it contains the area's centre
 * (the area lies inside it). A cell that only the layout box covers is left out.
 */
export function printedTiles(grid: TileGrid, regions: readonly (readonly Point[])[]): Tile[] {
  const boxed = regions
    .filter((region) => region.length > 0)
    .map((region) => ({ region, box: boxOf(region) }));
  const tiles: Tile[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const rect = tileRect(grid, row, col);
      if (boxed.some(({ region, box }) => overlaps(rect, region, box))) {
        tiles.push({ row, col, label: tileLabel(row, col), rect });
      }
    }
  }
  return tiles;
}

function overlaps(rect: Bounds, region: readonly Point[], box: Bounds): boolean {
  const missesX = box.maxX < rect.minX || box.minX > rect.maxX;
  if (missesX || box.maxY < rect.minY || box.minY > rect.maxY) return false;
  for (let i = 0; i < region.length; i++) {
    if (rectSegmentDistance(rect, region[i]!, region[(i + 1) % region.length]!) === 0) return true;
  }
  return insidePolygon(region, (rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2);
}

/** The box around `points` (at least one). */
export function boxOf(points: readonly Point[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}
