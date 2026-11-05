// The laid-out pieces of a project, ready to print (docs/adr/0012-pdf-printing.md). The layout is
// `layoutProject`, which the project page's view (assets/js/hooks/pattern_view.js) also calls when
// it draws anew. The PDF always lays the result out afresh, while the view keeps its last layout
// during point edits, so after one the PDF may place a piece where the page's next layout would.
// Every coordinate is moved to its place in the drawing (mm).

import type { ProjectSeamAllowances } from "../editor/edges";
import {
  grainlineArrowheads,
  type LabelPiece,
  outlinePolygon,
  placeLabel,
} from "../geometry/label";
import { type Offset, shiftCurve } from "../geometry/layout";
import { cuttingLineNotches } from "../geometry/notches";
import { layoutProject, type ProjectLayout } from "../geometry/project-layout";
import type { Bounds } from "../geometry/svg";
import type { ComputedCurve, ComputedPattern, ComputedPiece, NotchMark } from "../geometry/types";
import type { Point } from "../geometry/vector";

/**
 * A label to write: `lines` of text centred as a block on `(x, y)` (`anchor` `"middle"`), or
 * starting at `x` (`"start"`, the fallback beside the grainline), at font `size` (mm).
 */
export type PrintLabel = {
  lines: string[];
  x: number;
  y: number;
  size: number;
  anchor: "middle" | "start";
};

/** One piece as printed, every point in drawing coordinates (mm). */
export type PrintPiece = {
  part: string;
  piece: string;
  /** The cutting line (closed polygon, last point not repeated), or `null` when there is none. */
  cutting: Point[] | null;
  /** The seam line: the piece's outline curves. */
  outline: ComputedCurve[];
  /** The outline curves on the fold, in outline order. */
  folds: ComputedCurve[];
  grainline: { from: Point; to: Point };
  /** The grainline's arrowheads as `[tip, left, right]` (see `grainlineArrowheads`). */
  arrowheads: [Point, Point, Point][];
  /** The notch marks on the seam line, then the same notches' marks on the cutting line. */
  notches: NotchMark[];
  label: PrintLabel;
  /** Where the piece is on paper: the cutting line, else the outline polygon. */
  region: Point[];
};

/** The printed pieces in part and piece order, and the box around all of them (`null`: none). */
export type PrintDrawing = { pieces: PrintPiece[]; bounds: Bounds | null };

/** The label font size (mm) in print; `placeLabel` shrinks it in small pieces, as on screen. */
export const PRINT_LABEL_SIZE = 10;

/**
 * The pieces of `parts` (an ok `ProjectResult`'s parts, in order) laid out by `layoutProject` for
 * `allowances`, with their labels: `layoutDrawing(layoutProject(parts, allowances), labels)`.
 */
export function printDrawing(
  parts: Readonly<Record<string, Pick<ComputedPattern, "pieces">>>,
  allowances: ProjectSeamAllowances,
  labels: Readonly<Record<string, Readonly<Record<string, string>>>>,
): PrintDrawing {
  return layoutDrawing(layoutProject(parts, allowances), labels);
}

/**
 * The pieces of `layout` moved to their place, with their cutting lines and their labels:
 * `labels[part][piece]` (own keys only, lines split on `"\n"`), else the piece name. The labels
 * are placed here, so a caller can check `layout.bounds` (e.g. the tile cap) before this work.
 * Pure; never throws for a computed result.
 */
export function layoutDrawing(
  layout: ProjectLayout,
  labels: Readonly<Record<string, Readonly<Record<string, string>>>>,
): PrintDrawing {
  const pieces = layout.parts.flatMap(({ name: part, pieces }) =>
    pieces.map(({ piece, cutting, offset }) =>
      printPiece(
        part,
        piece,
        cutting.ok ? cutting.points : null,
        labelText(labels, part, piece.name),
        offset,
      ),
    ),
  );
  return { pieces, bounds: layout.bounds };
}

function printPiece(
  part: string,
  piece: ComputedPiece,
  cutting: Point[] | null,
  text: string,
  { dx, dy }: Offset,
): PrintPiece {
  const move = (point: Readonly<Point>): Point => ({ x: point.x + dx, y: point.y + dy });
  const moveMark = (mark: NotchMark): NotchMark => ({ from: move(mark.from), to: move(mark.to) });
  const outline = piece.outline.map((curve) => shiftCurve(curve, dx, dy));
  const grainline = { from: move(piece.grainline.from), to: move(piece.grainline.to) };
  const seamMarks = piece.notches.flatMap((notch) => notch.marks);
  const cuttingMarks =
    cutting === null
      ? []
      : cuttingLineNotches(piece.notches, cutting).flatMap((notch) => notch.marks);
  const movedCutting = cutting === null ? null : cutting.map(move);
  return {
    part,
    piece: piece.name,
    cutting: movedCutting,
    outline,
    folds: outline.filter((curve) => piece.folds.includes(curve.name)),
    grainline,
    arrowheads: grainlineArrowheads(grainline),
    notches: [...seamMarks, ...cuttingMarks].map(moveMark),
    label: printLabel(piece, text, move),
    region: movedCutting ?? outlinePolygon({ outline, grainline }),
  };
}

// Placed on the piece as computed (the placement only depends on its shape), then moved. Without
// room inside the piece, the view's fallback: beside the grainline's midpoint, start-anchored half
// a size to its right.
function printLabel(piece: LabelPiece, text: string, move: (point: Point) => Point): PrintLabel {
  const lines = text.split("\n");
  const placed = placeLabel(piece, text, PRINT_LABEL_SIZE);
  if (placed !== null) {
    return { lines, ...move(placed), size: placed.size, anchor: "middle" };
  }
  const { from, to } = piece.grainline;
  const at = move({ x: (from.x + to.x) / 2 + PRINT_LABEL_SIZE / 2, y: (from.y + to.y) / 2 });
  return { lines, ...at, size: PRINT_LABEL_SIZE, anchor: "start" };
}

function labelText(
  labels: Readonly<Record<string, Readonly<Record<string, string>>>>,
  part: string,
  piece: string,
): string {
  const texts = own(labels, part);
  const text = typeof texts === "object" && texts !== null ? own(texts, piece) : undefined;
  return typeof text === "string" && text !== "" ? text : piece;
}

/** An own property of `record`, never one inherited from its prototype. */
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
