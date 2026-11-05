// The 1:1 PDF of a project (docs/adr/0012-pdf-printing.md): page 1 with the title, the
// instructions, a 10 × 10 cm test square and an overview map, then one page per printed tile in
// reading order. Every point is converted to page points here (1 mm = PT_PER_MM pt, no scaling and
// no flip in the content stream), so the written numbers are the printed lengths.

import type { ProjectSeamAllowances } from "../editor/edges";
import { CHAR_WIDTH_RATIO, LABEL_LINE_HEIGHT } from "../geometry/label";
import { layoutProject } from "../geometry/project-layout";
import type { Bounds } from "../geometry/svg";
import type { ComputedCurve, ComputedPattern } from "../geometry/types";
import type { Point } from "../geometry/vector";
import { layoutDrawing, type PrintDrawing, type PrintPiece } from "./drawing";
import { PAPER_SIZES, type Paper, PRINT_MARGIN, PT_PER_MM, TILE_OVERLAP } from "./paper";
import { type PdfPage, pdfNumber, pdfText, writePdf } from "./pdf-writer";
import { boxOf, printedTiles, type Tile, type TileGrid, tileGrid } from "./tiles";

/** The texts of page 1, in the user's language. */
export type PrintTexts = {
  /** Written in the test square ("10 × 10 cm"). */
  testSquare: string;
  /** Asks for printing at 100 % and checking the square. */
  scaleCheck: string;
  /** How to put the pages together. */
  assembly: string;
  /** The heading of the overview map. */
  overview: string;
};

/** What `patternPdf` prints. */
export type PatternPdfInput = {
  /** An ok `ProjectResult`'s parts, in order. */
  parts: Readonly<Record<string, Pick<ComputedPattern, "pieces">>>;
  allowances: ProjectSeamAllowances;
  /** Label text by part and piece (`"Name\ncut 2"`); see `printDrawing`. */
  labels: Readonly<Record<string, Readonly<Record<string, string>>>>;
  paper: Paper;
  /** The project name: page 1's title and the document title. */
  title: string;
  texts: PrintTexts;
};

/** The PDF, or why there is none. `pages` counts page 1. */
export type PatternPdfResult =
  | { ok: true; bytes: Uint8Array; pages: number }
  | { ok: false; kind: "nothing_to_print" | "too_many_pages" | "failed" };

/** A page of the PDF with its tile label ("B3"), `null` for page 1. */
export type LabelledPage = PdfPage & { label: string | null };

/** Which neighbours of a tile are printed too. */
export type Neighbours = { left: boolean; right: boolean; top: boolean; bottom: boolean };

const K = PT_PER_MM;
/** The seam line's dash pattern, 4 mm on and 2 mm off. */
const SEAM_DASH = `[${numbers(4 * K, 2 * K)}] 0 d`;
/** The fold's dash-dot pattern: 10 mm on, 2 off, 2 on, 2 off. */
const FOLD_DASH = `[${numbers(10 * K, 2 * K, 2 * K, 2 * K)}] 0 d`;
/** The distance (as a fraction of the size) from a line's middle down to its baseline. */
const BASELINE_SHIFT = 0.35;
/** The across size (mm) of the alignment diamond on a join line. */
const DIAMOND_SIZE = 6;
const TEST_SQUARE = 100; // mm
const TILE_LABEL_SIZE = 36; // pt
const TITLE_SIZE = 16; // pt
const BODY_SIZE = 10; // pt
const HEADING_SIZE = 12; // pt
const MAP_LABEL_SIZE = 8; // pt
const GAP = 12; // pt between blocks on page 1

/**
 * The PDF of the project: page 1 and one page per printed tile, for `input.paper`. Never throws:
 * `nothing_to_print` when nothing has a box, `too_many_pages` when the grid would exceed
 * MAX_PRINT_TILES, `failed` for anything unexpected.
 */
export function patternPdf(input: PatternPdfInput): PatternPdfResult {
  try {
    const pages = pdfPages(input);
    if (!pages.ok) return pages;
    const bytes = writePdf({ title: input.title, pages: pages.pages });
    return { ok: true, bytes, pages: pages.pages.length };
  } catch {
    return { ok: false, kind: "failed" };
  }
}

/** The pages of `patternPdf`, before writing: page 1, then the tiles row by row. */
export function pdfPages(
  input: PatternPdfInput,
):
  | { ok: true; pages: LabelledPage[] }
  | { ok: false; kind: "nothing_to_print" | "too_many_pages" } {
  // The cap is checked on the layout's box, before the labels are placed or any tile is drawn.
  const layout = layoutProject(input.parts, input.allowances);
  if (layout.bounds === null) return { ok: false, kind: "nothing_to_print" };
  const grid = tileGrid(layout.bounds, input.paper);
  if (grid === null) return { ok: false, kind: "too_many_pages" };
  const drawing = layoutDrawing(layout, input.labels);
  const tiles = printedTiles(grid, drawing.pieces.map((piece) => piece.region));
  if (tiles.length === 0) return { ok: false, kind: "nothing_to_print" };

  const printed = new Set(tiles.map((tile) => `${tile.row},${tile.col}`));
  const has = (row: number, col: number): boolean => printed.has(`${row},${col}`);
  const { width, height } = pageSize(input.paper);
  const content = firstPageContent(input, drawing, grid, tiles);
  const first = { width, height, label: null, content };
  const rest = tiles.map((tile) => ({
    width,
    height,
    label: tile.label,
    content: tilePageContent(drawing, grid, tile, {
      left: has(tile.row, tile.col - 1),
      right: has(tile.row, tile.col + 1),
      top: has(tile.row - 1, tile.col),
      bottom: has(tile.row + 1, tile.col),
    }),
  }));
  return { ok: true, pages: [first, ...rest] };
}

/**
 * The function from pattern mm to page points for `tile`: the top left of its printable area is
 * PRINT_MARGIN in from the page's top left, at 1:1, y up as in PDF.
 */
export function pageTransform(grid: TileGrid, tile: Pick<Tile, "rect">): (p: Point) => Point {
  const { height } = pageSize(grid.paper);
  const margin = PRINT_MARGIN * K;
  return (p) => ({
    x: margin + (p.x - tile.rect.minX) * K,
    y: height - margin - (p.y - tile.rect.minY) * K,
  });
}

/**
 * The content of a tile page: its label large and light under everything, then, clipped to the
 * printable area, the pieces that reach it, and the join line and diamond on each side with a
 * printed `neighbours` page.
 */
export function tilePageContent(
  drawing: PrintDrawing,
  grid: TileGrid,
  tile: Tile,
  neighbours: Neighbours,
): string {
  const { width, height } = pageSize(grid.paper);
  const toPage = pageTransform(grid, tile);
  const ops: string[] = [];

  const labelWidth = estimatedWidth(tile.label, TILE_LABEL_SIZE);
  const labelX = width / 2 - labelWidth / 2;
  const labelY = height / 2 - BASELINE_SHIFT * TILE_LABEL_SIZE;
  ops.push("q 0.85 g", text("F2", TILE_LABEL_SIZE, labelX, labelY, tile.label), "Q");

  const { rect } = tile;
  ops.push("q", `${rectangle(toPage, rect)} re W n`);
  for (const piece of drawing.pieces) {
    if (boxesMeet(boxOf(piece.region), rect)) ops.push(pieceContent(piece, toPage));
  }

  const joins: [Point, Point][] = [];
  const midX = (rect.minX + rect.maxX) / 2;
  const midY = (rect.minY + rect.maxY) / 2;
  const half = TILE_OVERLAP / 2;
  if (neighbours.right) joins.push(vertical(rect.maxX - half, rect));
  if (neighbours.left) joins.push(vertical(rect.minX + half, rect));
  if (neighbours.bottom) joins.push(horizontal(rect.maxY - half, rect));
  if (neighbours.top) joins.push(horizontal(rect.minY + half, rect));
  if (joins.length > 0) {
    ops.push("0.3 w 0.4 G");
    for (const [from, to] of joins) {
      ops.push(`${pair(toPage(from))} m ${pair(toPage(to))} l S`);
      const centre = from.x === to.x ? { x: from.x, y: midY } : { x: midX, y: from.y };
      ops.push(polygon(diamond(centre).map(toPage), "S"));
    }
  }
  ops.push("Q");
  return ops.join("\n");
}

/**
 * The drawing operators of one piece, with `toPage` from pattern mm to page points: the cutting
 * line (solid), the seam line (dashed), the folds (dash-dot), the grainline with filled arrowheads,
 * the notch marks and the label. Wrapped in `q`/`Q`, so it leaves the graphics state as it was.
 */
export function pieceContent(piece: PrintPiece, toPage: (p: Point) => Point): string {
  const ops: string[] = ["q 0 g 0 G"];
  if (piece.cutting !== null && piece.cutting.length >= 2) {
    ops.push("0.8 w 1 j", polygon(piece.cutting.map(toPage), "S"));
  }
  const [first] = piece.outline;
  if (first !== undefined) {
    ops.push(`0.5 w ${SEAM_DASH}`);
    const curves = piece.outline.map((curve) => curveOp(curve, toPage));
    ops.push([`${pair(toPage(first.from))} m`, ...curves, "h S"].join("\n"));
  }
  if (piece.folds.length > 0) {
    ops.push(`0.8 w ${FOLD_DASH}`);
    for (const curve of piece.folds) {
      ops.push(`${pair(toPage(curve.from))} m ${curveOp(curve, toPage)} S`);
    }
  }
  ops.push("[] 0 d");
  const { from, to } = piece.grainline;
  ops.push(`0.5 w ${pair(toPage(from))} m ${pair(toPage(to))} l S`);
  for (const head of piece.arrowheads) ops.push(polygon(head.map(toPage), "f"));
  if (piece.notches.length > 0) {
    ops.push("0.8 w 1 J");
    for (const mark of piece.notches) {
      ops.push(`${pair(toPage(mark.from))} m ${pair(toPage(mark.to))} l S`);
    }
  }
  ops.push(labelContent(piece, toPage), "Q");
  return ops.join("\n");
}

/**
 * `text` split into lines at most `width` wide at font `size` (same unit), greedily by words,
 * with the engine's estimated character width. A word wider than `width` gets a line of its own;
 * whitespace-only text gives no lines.
 */
export function wrapText(text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((part) => part !== "")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (line !== "" && estimatedWidth(candidate, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** Page 1: the title, the texts, the test square and the overview map, from the top left. */
function firstPageContent(
  input: PatternPdfInput,
  drawing: PrintDrawing,
  grid: TileGrid,
  tiles: readonly Tile[],
): string {
  const { width, height } = pageSize(grid.paper);
  const margin = PRINT_MARGIN * K;
  const printableWidth = width - 2 * margin;
  const ops: string[] = ["0 g 0 G"];
  // `top` is the distance (pt) from the page's top edge to the next free line.
  let top = margin;
  const paragraph = (font: "F1" | "F2", size: number, content: string): void => {
    for (const line of wrapText(content, size, printableWidth)) {
      top += size * LABEL_LINE_HEIGHT;
      ops.push(text(font, size, margin, height - top + (LABEL_LINE_HEIGHT - 1) * size, line));
    }
    top += GAP / 2;
  };
  paragraph("F2", TITLE_SIZE, input.title);
  paragraph("F1", BODY_SIZE, input.texts.scaleCheck);
  paragraph("F1", BODY_SIZE, input.texts.assembly);

  // The test square: its side is exactly TEST_SQUARE mm.
  const side = TEST_SQUARE * K;
  top += GAP / 2;
  const squareBottom = height - top - side;
  ops.push(`0.5 w ${numbers(margin, squareBottom, side, side)} re S`);
  const squareText = estimatedWidth(input.texts.testSquare, HEADING_SIZE);
  ops.push(
    text(
      "F1",
      HEADING_SIZE,
      margin + side / 2 - squareText / 2,
      squareBottom + side / 2 - BASELINE_SHIFT * HEADING_SIZE,
      input.texts.testSquare,
    ),
  );
  top += side + GAP;

  paragraph("F2", HEADING_SIZE, input.texts.overview);
  const mapArea = { left: margin, top, width: printableWidth, height: height - margin - top };
  ops.push(overviewMap(drawing, grid, tiles, mapArea, height));
  return ops.join("\n");
}

/** The pieces' regions scaled down into `area` (pt, from the page top), and a cell per tile. */
function overviewMap(
  drawing: PrintDrawing,
  grid: TileGrid,
  tiles: readonly Tile[],
  area: { left: number; top: number; width: number; height: number },
  pageHeight: number,
): string {
  const gridWidth = (grid.cols - 1) * grid.step.x + grid.area.width;
  const gridHeight = (grid.rows - 1) * grid.step.y + grid.area.height;
  const scale = Math.min(area.width / gridWidth, area.height / gridHeight);
  if (!(scale > 0)) return "";
  const toMap = (p: Point): Point => ({
    x: area.left + (p.x - grid.origin.x) * scale,
    y: pageHeight - area.top - (p.y - grid.origin.y) * scale,
  });
  const ops: string[] = ["q 0.5 w 1 j"];
  for (const piece of drawing.pieces) {
    if (piece.region.length >= 2) ops.push(polygon(piece.region.map(toMap), "S"));
  }
  ops.push("0.3 w");
  for (const tile of tiles) {
    const minX = grid.origin.x + tile.col * grid.step.x;
    const minY = grid.origin.y + tile.row * grid.step.y;
    const maxX = tile.col === grid.cols - 1 ? grid.origin.x + gridWidth : minX + grid.step.x;
    const maxY = tile.row === grid.rows - 1 ? grid.origin.y + gridHeight : minY + grid.step.y;
    ops.push(`${rectangle(toMap, { minX, minY, maxX, maxY })} re S`);
    const centre = toMap({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    const labelX = centre.x - estimatedWidth(tile.label, MAP_LABEL_SIZE) / 2;
    const labelY = centre.y - BASELINE_SHIFT * MAP_LABEL_SIZE;
    ops.push(text("F1", MAP_LABEL_SIZE, labelX, labelY, tile.label));
  }
  ops.push("Q");
  return ops.join("\n");
}

// The label's lines as a block centred on its point (as the view draws it with
// dominant-baseline="middle"), each line centred on x for anchor "middle".
function labelContent(piece: PrintPiece, toPage: (p: Point) => Point): string {
  const { lines, x, y, size, anchor } = piece.label;
  const step = LABEL_LINE_HEIGHT * size;
  const firstMiddle = y - ((lines.length - 1) / 2) * step;
  const ops = lines.map((line, i) => {
    const startX = anchor === "middle" ? x - estimatedWidth(line, size) / 2 : x;
    const at = toPage({ x: startX, y: firstMiddle + i * step + BASELINE_SHIFT * size });
    return text("F1", size * K, at.x, at.y, line);
  });
  return ops.join("\n");
}

function curveOp(curve: ComputedCurve, toPage: (p: Point) => Point): string {
  if (curve.type === "cubic") {
    return `${pair(toPage(curve.c1))} ${pair(toPage(curve.c2))} ${pair(toPage(curve.to))} c`;
  }
  return `${pair(toPage(curve.to))} l`;
}

function text(font: "F1" | "F2", size: number, x: number, y: number, content: string): string {
  return `BT /${font} ${pdfNumber(size)} Tf ${numbers(x, y)} Td ${pdfText(content)} Tj ET`;
}

/** The operands `x y width height` of `re` for the pattern box `box`, mapped by `toPage`. */
function rectangle(toPage: (p: Point) => Point, box: Bounds): string {
  const lowerLeft = toPage({ x: box.minX, y: box.maxY });
  const upperRight = toPage({ x: box.maxX, y: box.minY });
  return numbers(lowerLeft.x, lowerLeft.y, upperRight.x - lowerLeft.x, upperRight.y - lowerLeft.y);
}

function numbers(...values: number[]): string {
  return values.map(pdfNumber).join(" ");
}

/** A closed path through `points`, painted with `paint` (`S` stroke, `f` fill). */
function polygon(points: readonly Point[], paint: "S" | "f"): string {
  const [first, ...rest] = points;
  if (first === undefined) return "";
  return [`${pair(first)} m`, ...rest.map((point) => `${pair(point)} l`), `h ${paint}`].join("\n");
}

function pair(point: Point): string {
  return numbers(point.x, point.y);
}

/** The engine's estimated width of `text` at font `size` (same unit as the size). */
function estimatedWidth(content: string, size: number): number {
  return [...content].length * size * CHAR_WIDTH_RATIO;
}

function pageSize(paper: Paper): { width: number; height: number } {
  const size = PAPER_SIZES[paper];
  return { width: size.width * K, height: size.height * K };
}

function vertical(x: number, rect: Bounds): [Point, Point] {
  return [
    { x, y: rect.minY },
    { x, y: rect.maxY },
  ];
}

function horizontal(y: number, rect: Bounds): [Point, Point] {
  return [
    { x: rect.minX, y },
    { x: rect.maxX, y },
  ];
}

function diamond(centre: Point): Point[] {
  const r = DIAMOND_SIZE / 2;
  return [
    { x: centre.x, y: centre.y - r },
    { x: centre.x + r, y: centre.y },
    { x: centre.x, y: centre.y + r },
    { x: centre.x - r, y: centre.y },
  ];
}

function boxesMeet(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}
