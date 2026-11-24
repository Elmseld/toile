import { describe, expect, test } from "bun:test";
import { project, rectangles } from "../../test/support/print-fixtures";
import type { ProjectSeamAllowances } from "../editor/edges";
import * as engine from "../index";
import { layoutParts, layoutPieces, PART_GAP, PIECE_GAP } from "./layout";
import { layoutProject } from "./project-layout";
import {
  type CuttingLineResult,
  cuttingLine,
  pieceSeamAllowances,
  type SeamAllowances,
} from "./seam-allowance";
import { patternBounds } from "./svg";
import type { ComputedPiece } from "./types";

const ALLOWANCES: ProjectSeamAllowances = { default: 10, edges: {} };

// Two overlapping 100 mm squares in part "one" (b 50 mm right of a), a 50 mm square in "two".
const PARTS = {
  one: rectangles(["a", 0, 0, 100, 100], ["b", 50, 0, 100, 100]),
  two: rectangles(["c", 0, 0, 50, 50]),
};

describe("layoutProject", () => {
  test("moves the pieces apart over their boxes with the cutting line, then the parts", () => {
    const layout = layoutProject(PARTS, ALLOWANCES);
    expect(layout.parts.map(({ name }) => name)).toEqual(["one", "two"]);
    const [one, two] = layout.parts;
    expect(one!.pieces.map(({ piece }) => piece.name)).toEqual(["a", "b"]);
    // a's cutting box is -10..110, b's 40..160: b moves to 130, PIECE_GAP right of a.
    expect(one!.offset).toEqual({ dx: 0, dy: 0 });
    expect(one!.pieces.map(({ local }) => local)).toEqual([
      { dx: 0, dy: 0 },
      { dx: 110 + PIECE_GAP - 40, dy: 0 },
    ]);
    // Part one spans -10..250, so c (-10..60) moves PART_GAP right of it.
    const partDx = 250 + PART_GAP + 10;
    expect(two!.offset).toEqual({ dx: partDx, dy: 0 });
    expect(two!.pieces[0]!.offset).toEqual({ dx: partDx, dy: 0 });
    expect(layout.bounds).toEqual({ minX: -10, minY: -10, maxX: partDx + 60, maxY: 110 });
  });

  test("gives each piece the part's offset plus its own, and its cutting line", () => {
    const result = project("bodice", "straight_sleeve");
    const allowances: ProjectSeamAllowances = { default: 15, edges: { bodice: { b_side: 40 } } };
    const layout = layoutProject(result.parts, allowances);

    // The same pipeline by hand.
    const lines = Object.entries(result.parts).map(([part, { pieces }]) =>
      Object.values(pieces).map((piece) =>
        cuttingLine(piece, pieceSeamAllowances(piece, 15, allowances.edges[part])),
      ),
    );
    const pieceLayouts = Object.values(result.parts).map(({ pieces }, i) =>
      layoutPieces(
        Object.values(pieces).map((piece, j) => {
          const line = lines[i]![j]!;
          return patternBounds({ pieces: { [piece.name]: piece } }, line.ok ? [line.points] : []);
        }),
      ),
    );
    const partsLayout = layoutParts(pieceLayouts.map(({ bounds }) => bounds));

    expect(layout.bounds).toEqual(partsLayout.bounds);
    layout.parts.forEach((part, i) => {
      expect(part.offset).toEqual(partsLayout.offsets[i]!);
      part.pieces.forEach((entry, j) => {
        const local = pieceLayouts[i]!.offsets[j]!;
        expect(entry.local).toEqual(local);
        const { dx, dy } = part.offset;
        expect(entry.offset).toEqual({ dx: dx + local.dx, dy: dy + local.dy });
        expect(entry.cutting).toEqual(lines[i]![j]!);
      });
    });
  });

  test("uses the part's own edge values", () => {
    const layout = layoutProject(PARTS, { default: 10, edges: { one: { a_right: 30 } } });
    // a's cutting box now ends at 130, so b moves to 150.
    expect(layout.parts[0]!.pieces[1]!.local).toEqual({ dx: 130 + PIECE_GAP - 40, dy: 0 });
  });

  test("reads the edge values by own keys only", () => {
    const inherited = Object.create({ one: { a_right: 30 } }) as ProjectSeamAllowances["edges"];
    const layout = layoutProject(PARTS, { default: 10, edges: inherited });
    expect(layout).toEqual(layoutProject(PARTS, ALLOWANCES));
  });

  test("asks cuttingLineOf for each piece with its allowances and lays out with its answer", () => {
    const calls: [string, string, SeamAllowances][] = [];
    const failed: CuttingLineResult = { ok: false, errors: [] };
    const cuttingLineOf = (part: string, piece: ComputedPiece, allowances: SeamAllowances) => {
      calls.push([part, piece.name, allowances]);
      return failed;
    };
    const edges = { one: { a_right: 30 } };
    const layout = layoutProject(PARTS, { default: 10, edges }, cuttingLineOf);

    expect(calls).toEqual([
      ["one", "a", pieceSeamAllowances(PARTS.one.pieces.a!, 10, edges.one)],
      ["one", "b", pieceSeamAllowances(PARTS.one.pieces.b!, 10, edges.one)],
      ["two", "c", pieceSeamAllowances(PARTS.two.pieces.c!, 10, undefined)],
    ]);
    // Without a cutting line the boxes are the outlines: a is 0..100, b 50..150, so b moves 70.
    const [a, b] = layout.parts[0]!.pieces;
    expect(a!.cutting).toBe(failed);
    expect(b!.local).toEqual({ dx: 100 + PIECE_GAP - 50, dy: 0 });
  });

  test("has no parts and no bounds for no parts, and no bounds for parts without pieces", () => {
    expect(layoutProject({}, ALLOWANCES)).toEqual({ parts: [], bounds: null });
    expect(layoutProject({ empty: { pieces: {} } }, ALLOWANCES)).toEqual({
      parts: [{ name: "empty", offset: { dx: 0, dy: 0 }, pieces: [] }],
      bounds: null,
    });
  });

  test("is exported from the engine's entry point", () => {
    expect(engine.layoutProject).toBe(layoutProject);
  });
});
