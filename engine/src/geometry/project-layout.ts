// The layout of a whole project (ADR 0007, ADR 0011): every piece's cutting line, the pieces of
// each part moved apart by `layoutPieces` over their boxes with the cutting line, and the parts
// placed side by side by `layoutParts`. The project page's view and the PDF both call it, so they
// lay a result out the same way (docs/adr/0012-pdf-printing.md).

import type { ProjectSeamAllowances } from "../editor/edges";
import { layoutParts, layoutPieces, type Offset } from "./layout";
import {
  type CuttingLineResult,
  cuttingLine,
  pieceSeamAllowances,
  type SeamAllowances,
} from "./seam-allowance";
import { type Bounds, patternBounds } from "./svg";
import type { ComputedPattern, ComputedPiece } from "./types";

/** Where one piece goes, with the cutting line its box was taken with. */
export type PieceLayout = {
  piece: ComputedPiece;
  /** The cutting line `cuttingLineOf` gave; a failed one leaves the piece's box without it. */
  cutting: CuttingLineResult;
  /** The offset within the part (from `layoutPieces`), e.g. for the piece's group in the part's. */
  local: Offset;
  /** The offset in the drawing: the part's offset plus `local`. */
  offset: Offset;
};

/** Where one part goes (from `layoutParts`), and its pieces in piece order. */
export type PartLayout = { name: string; offset: Offset; pieces: PieceLayout[] };

/** The laid-out parts in the given order, and the box around all of them (`null`: none). */
export type ProjectLayout = { parts: PartLayout[]; bounds: Bounds | null };

/**
 * Computes a project's cutting line for one piece. `allowances` are the piece's own, from
 * `pieceSeamAllowances` with the part's edge values; a view may return a cached line for them.
 */
export type CuttingLineOf = (
  part: string,
  piece: ComputedPiece,
  allowances: SeamAllowances,
) => CuttingLineResult;

/**
 * Lays out `parts` (an ok `ProjectResult`'s parts, in order) for `allowances`: each piece's
 * cutting line comes from `cuttingLineOf` (by default `cuttingLine`) with `pieceSeamAllowances` of
 * the part's own edge values, the pieces of a part are moved apart by `layoutPieces` over their
 * `patternBounds` with that line, and the parts placed by `layoutParts` over the parts' boxes.
 * `bounds` is the union of the moved boxes, for fitting a view or tiling pages. Pure, apart from
 * what `cuttingLineOf` does; never throws for a computed result.
 */
export function layoutProject(
  parts: Readonly<Record<string, Pick<ComputedPattern, "pieces">>>,
  allowances: ProjectSeamAllowances,
  cuttingLineOf: CuttingLineOf = (_part, piece, own) => cuttingLine(piece, own),
): ProjectLayout {
  const prepared = Object.entries(parts).map(([name, result]) => {
    const edges = Object.hasOwn(allowances.edges, name) ? allowances.edges[name] : undefined;
    const pieces = Object.values(result.pieces).map((piece) => ({
      piece,
      cutting: cuttingLineOf(name, piece, pieceSeamAllowances(piece, allowances.default, edges)),
    }));
    const layout = layoutPieces(
      pieces.map(({ piece, cutting }) =>
        patternBounds({ pieces: { [piece.name]: piece } }, cutting.ok ? [cutting.points] : []),
      ),
    );
    return { name, pieces, layout };
  });
  const layout = layoutParts(prepared.map(({ layout }) => layout.bounds));
  return {
    parts: prepared.map(({ name, pieces, layout: local }, i) => {
      const offset = layout.offsets[i]!;
      return {
        name,
        offset,
        pieces: pieces.map(({ piece, cutting }, j) => {
          const own = local.offsets[j]!;
          return {
            piece,
            cutting,
            local: own,
            offset: { dx: offset.dx + own.dx, dy: offset.dy + own.dy },
          };
        }),
      };
    }),
    bounds: layout.bounds,
  };
}
