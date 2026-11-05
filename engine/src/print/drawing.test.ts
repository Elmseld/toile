import { describe, expect, test } from "bun:test";
import { project, rectangles } from "../../test/support/print-fixtures";
import type { ProjectSeamAllowances } from "../editor/edges";
import { outlinePolygon } from "../geometry/label";
import { PART_GAP, PIECE_GAP } from "../geometry/layout";
import {
  cuttingLine,
  DEFAULT_SEAM_ALLOWANCE,
  pieceSeamAllowances,
} from "../geometry/seam-allowance";
import { PRINT_LABEL_SIZE, type PrintPiece, printDrawing } from "./drawing";
import { boxOf } from "./tiles";

const DEFAULTS: ProjectSeamAllowances = { default: DEFAULT_SEAM_ALLOWANCE, edges: {} };

/** The horizontal or vertical gap between two boxes (negative when they overlap both ways). */
function gap(a: PrintPiece, b: PrintPiece): number {
  const p = boxOf(a.region);
  const q = boxOf(b.region);
  return Math.max(q.minX - p.maxX, p.minX - q.maxX, q.minY - p.maxY, p.minY - q.maxY);
}

describe("printDrawing on the skirt", () => {
  const result = project("straight_skirt");
  const part = result.parts.straight_skirt!;
  const drawing = printDrawing(result.parts, DEFAULTS, {
    straight_skirt: { front: "Front\ncut 1 on fold" },
  });
  const [back, front] = drawing.pieces;

  test("has both pieces in piece order, apart by at least PIECE_GAP", () => {
    expect(drawing.pieces.map((piece) => [piece.part, piece.piece])).toEqual([
      ["straight_skirt", "back"],
      ["straight_skirt", "front"],
    ]);
    expect(gap(back!, front!)).toBeGreaterThanOrEqual(PIECE_GAP - 1e-9);
    expect(drawing.bounds).not.toBeNull();
  });

  test("has each piece's cutting line, moved with the piece", () => {
    for (const printed of drawing.pieces) {
      const piece = part.pieces[printed.piece]!;
      const line = cuttingLine(piece, pieceSeamAllowances(piece, DEFAULT_SEAM_ALLOWANCE));
      if (!line.ok) throw new Error("no cutting line");
      expect(printed.cutting).toHaveLength(line.points.length);
      expect(printed.region).toBe(printed.cutting!);
      // Moved by the same offset as the outline.
      const dx = printed.outline[0]!.from.x - piece.outline[0]!.from.x;
      expect(printed.cutting![0]!.x - line.points[0]!.x).toBeCloseTo(dx, 9);
    }
  });

  test("lies inside the drawing's bounds", () => {
    const bounds = drawing.bounds!;
    for (const printed of drawing.pieces) {
      const box = boxOf(printed.region);
      expect(box.minX).toBeGreaterThanOrEqual(bounds.minX - 1e-9);
      expect(box.maxX).toBeLessThanOrEqual(bounds.maxX + 1e-9);
      expect(box.minY).toBeGreaterThanOrEqual(bounds.minY - 1e-9);
      expect(box.maxY).toBeLessThanOrEqual(bounds.maxY + 1e-9);
    }
  });

  test("has the fold of the front (centre front) and none on the back", () => {
    expect(front!.folds.map((curve) => curve.name)).toEqual(["f_cf"]);
    expect(back!.folds).toEqual([]);
  });

  test("has the seam-line marks of each notch and the same marks on the cutting line", () => {
    // A single notch on the front, a double one on the back.
    expect(front!.notches).toHaveLength(2);
    expect(back!.notches).toHaveLength(4);
    const seamMark = front!.notches[0]!;
    const cutMark = front!.notches[1]!;
    // The cutting-line mark lies one seam allowance further out along the same line.
    const length = (m: typeof seamMark) => Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
    expect(length(cutMark)).toBeCloseTo(length(seamMark), 6);
    const apart = Math.hypot(cutMark.from.x - seamMark.from.x, cutMark.from.y - seamMark.from.y);
    expect(apart).toBeGreaterThan(DEFAULT_SEAM_ALLOWANCE - 1);
  });

  test("labels each piece with the given lines, else the piece name", () => {
    expect(front!.label.lines).toEqual(["Front", "cut 1 on fold"]);
    expect(front!.label.anchor).toBe("middle");
    expect(front!.label.size).toBeLessThanOrEqual(PRINT_LABEL_SIZE);
    expect(back!.label.lines).toEqual(["back"]);
  });

  test("has both arrowheads on the moved grainline", () => {
    for (const printed of drawing.pieces) {
      expect(printed.arrowheads).toHaveLength(2);
      expect(printed.arrowheads[0]![0]).toEqual(printed.grainline.to);
      expect(printed.arrowheads[1]![0]).toEqual(printed.grainline.from);
    }
  });
});

describe("printDrawing on the bodice with sleeve", () => {
  test("has the pieces of both parts, the parts at least PART_GAP apart", () => {
    const result = project("bodice", "straight_sleeve");
    const drawing = printDrawing(result.parts, DEFAULTS, {});
    expect(drawing.pieces.map((piece) => `${piece.part}/${piece.piece}`)).toEqual([
      "bodice/back",
      "bodice/front",
      "straight_sleeve/sleeve",
    ]);
    const bodice = drawing.pieces.filter((piece) => piece.part === "bodice");
    const sleeve = drawing.pieces.find((piece) => piece.part === "straight_sleeve")!;
    const bodiceMaxX = Math.max(...bodice.map((piece) => boxOf(piece.region).maxX));
    expect(boxOf(sleeve.region).minX - bodiceMaxX).toBeGreaterThanOrEqual(PART_GAP - 1e-6);
    expect(gap(bodice[0]!, bodice[1]!)).toBeGreaterThanOrEqual(PIECE_GAP - 1e-9);
  });
});

describe("printDrawing edge cases", () => {
  test("prints a piece without a cutting line with its outline as its region", () => {
    const pattern = rectangles(["box", 0, 0, 100, 50]);
    const drawing = printDrawing(
      { only: pattern },
      { default: DEFAULT_SEAM_ALLOWANCE, edges: { only: { box_top: 1000 } } },
      {},
    );
    const [piece] = drawing.pieces;
    expect(piece!.cutting).toBeNull();
    expect(piece!.region).toEqual(outlinePolygon(pattern.pieces.box!));
    expect(piece!.notches).toEqual([]);
    expect(drawing.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
  });

  test("reads the label maps by own keys only", () => {
    const pattern = rectangles(["front", 0, 0, 100, 50]);
    const inherited = Object.create({ front: "x" });
    const viaPart = Object.create({ only: { front: "y" } });
    for (const labels of [{ only: inherited }, viaPart, { only: { front: "" } }]) {
      const drawing = printDrawing({ only: pattern }, DEFAULTS, labels);
      expect(drawing.pieces[0]!.label.lines).toEqual(["front"]);
    }
  });

  test("falls back to beside the grainline when the label fits nowhere", () => {
    // A sliver 0.5 mm high: no label box fits inside.
    const pattern = rectangles(["thin", 0, 0, 300, 0.5]);
    const drawing = printDrawing({ only: pattern }, DEFAULTS, {});
    const { label, grainline } = drawing.pieces[0]!;
    expect(label.anchor).toBe("start");
    expect(label.size).toBe(PRINT_LABEL_SIZE);
    expect(label.x).toBeCloseTo((grainline.from.x + grainline.to.x) / 2 + PRINT_LABEL_SIZE / 2, 9);
  });

  test("has no pieces and no bounds for no parts", () => {
    expect(printDrawing({}, DEFAULTS, {})).toEqual({ pieces: [], bounds: null });
  });
});
