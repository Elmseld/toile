// Public API of the print module (docs/adr/0012-pdf-printing.md): the 1:1 PDF of a project,
// tiled over A4 or Letter pages, written by the engine itself with no dependency, so the browser
// makes it from the result it draws and `bun test` checks the scale.

export {
  type PrintDrawing,
  type PrintLabel,
  type PrintPiece,
  PRINT_LABEL_SIZE,
  printDrawing,
} from "./drawing";
export {
  MAX_PRINT_TILES,
  PAPER_SIZES,
  type Paper,
  type PaperSize,
  PRINT_MARGIN,
  PT_PER_MM,
  readPaper,
  TILE_OVERLAP,
} from "./paper";
export {
  type LabelledPage,
  type Neighbours,
  type PatternPdfInput,
  type PatternPdfResult,
  pageTransform,
  patternPdf,
  pdfPages,
  pieceContent,
  type PrintTexts,
  tilePageContent,
  wrapText,
} from "./pdf";
export {
  type PdfDocument,
  type PdfPage,
  pdfNumber,
  pdfText,
  winAnsiBytes,
  writePdf,
} from "./pdf-writer";
export {
  printedTiles,
  type Tile,
  type TileGrid,
  tileGrid,
  tileLabel,
  tileRect,
} from "./tiles";
