// Paper sizes and the fixed print parameters of the 1:1 PDF (docs/adr/0012-pdf-printing.md).
// Lengths are mm, except PT_PER_MM, which converts them to PDF points.

/** The paper sizes the PDF can be made for. */
export type Paper = "a4" | "letter";

/** A page size in mm. */
export type PaperSize = { readonly width: number; readonly height: number };

/** Portrait page size (mm) of each paper. */
export const PAPER_SIZES: Readonly<Record<Paper, PaperSize>> = Object.freeze({
  a4: Object.freeze({ width: 210, height: 297 }),
  letter: Object.freeze({ width: 215.9, height: 279.4 }),
});

/** PDF points per mm (a point is 1/72 inch, an inch 25.4 mm); every length is drawn at it. */
export const PT_PER_MM = 72 / 25.4;

/** The margin (mm) on every side of a page; nothing of the pattern is drawn in it. */
export const PRINT_MARGIN = 10;

/** How far (mm) the printable areas of neighbouring tile pages overlap. */
export const TILE_OVERLAP = 10;

/** The largest tile grid (rows × columns) a PDF is made for; a larger pattern gives no PDF. */
export const MAX_PRINT_TILES = 400;

/** The paper named by `value` (a select's value): `"letter"` is Letter, anything else A4. */
export function readPaper(value: unknown): Paper {
  return value === "letter" ? "letter" : "a4";
}
