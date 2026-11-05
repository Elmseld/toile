# 0012: PDF printing at 1:1 scale

Status: accepted (ticket 0010)

## Context
Home sewers print the pattern and tape the pages together. The PDF must be true to scale (the test
square measures 10 × 10 cm), show the pattern as the project page draws it (ADR 0009 cutting line,
ADR 0011 markings), and must not put geometry outside the engine (`docs/product.md`). The browser
already holds the computed result, including edits that are not saved yet.

## Decision
1. **Client-side, in the engine, no dependency.** The `PatternView` hook calls one pure engine
   function, `patternPdf`, on the result it already draws and its current allowances, and offers the
   returned bytes as a Blob download. There is no server endpoint. The PDF therefore reflects the
   working state, unsaved edits included.
2. **Hand-written PDF 1.4 writer** (`engine/src/print/pdf-writer.ts`): catalog, page tree, the two
   base-14 fonts Helvetica and Helvetica-Bold (WinAnsi, not embedded), an info dictionary, one page
   and one uncompressed ASCII content stream per page, and an xref table. Only lines, cubics,
   dashes, a clip, fills and plain text are drawn.
3. **Text is written as hex strings of WinAnsi bytes**, so user-controlled text (project name, piece
   labels) cannot break the syntax; characters WinAnsi lacks become `?`. The `/Title` is UTF-16BE
   hex. Text is centred with the engine's estimated width (`CHAR_WIDTH_RATIO`), not font metrics.
4. **Scale.** 1 mm is exactly 72/25.4 pt. The engine converts every point to page coordinates
   itself (no flip in the content stream), and no page is scaled. The test square is a `re` of
   283.465 pt; the tests check it and the length of a known line in the written bytes.
5. **Same layout as the view.** `printDrawing` calls `cuttingLine`/`pieceSeamAllowances`,
   `layoutPieces` per part and `layoutParts`, as the hook does, and uses the notches, labels and
   grainline arrowheads (`grainlineArrowheads`, shared with label placement). Label size is 10 mm
   in print.
6. **Tiling.** Pages are portrait, A4 or Letter (the user chooses; A4 by default, anything else
   counts as A4), with a 10 mm margin (`PRINT_MARGIN`) clipped to the printable area and 10 mm
   overlap between neighbours (`TILE_OVERLAP`). The grid is centred on the layout box with its
   cutting lines and has the fewest rows and columns that cover it. A page label gives the row as a
   letter (spreadsheet style, `AA` after `Z`) and the column as a number: "B3". Where two printed
   pages are neighbours, both draw a join line through the middle of the shared strip and a diamond
   on it; they lie at the same pattern position on both pages.
7. **Page 1** has the project name, a sentence asking for printing at 100 %, assembly instructions,
   a 10 × 10 cm test square and an overview map: the pieces scaled down with one labelled cell per
   printed page. Tile pages follow in reading order.
8. **Empty pages are not printed.** A tile is printed only if a piece's region (the cutting line, or
   the outline when there is none) overlaps its printable area; a cell that only the layout box
   covers is skipped and has no cell in the map.
9. **Bounded work.** A grid over `MAX_PRINT_TILES` (400) cells, or a layout without a box, gives no
   PDF; the page shows a plain-text message. The cap is checked before any per-tile work.
   `patternPdf` never throws.

## Alternatives rejected
- **Server-side rendering with Bun or headless Chrome:** the release image has no Bun, it needs a
  process per request, and it would not see unsaved edits.
- **pdf-lib or jsPDF:** the engine's first dependency (ADR 0009 rejected Clipper for the same
  reason), hundreds of kB, and jsPDF expects a browser.
- **Browser printing of the SVG (`window.print`):** scaling and tiling are not under our control,
  so 1:1 cannot be guaranteed.
- **Compressed streams:** `CompressionStream` is async and runtime specific; real patterns stay
  within a few hundred kB.
- **A Form XObject per drawing:** smaller files, but flipped text and harder tests; it can come
  later behind `patternPdf`.
- **Landscape or automatic orientation:** not asked for.

## Consequences
- The view and `printDrawing` both call the layout functions, so a change to the layout must change
  both.
- The paper choice is not stored; it resets to A4 on reload.
- Text centring can be a few mm off Helvetica's true widths; font metrics can be added later.
- Files are uncompressed.
