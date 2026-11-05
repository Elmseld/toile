// Public API of the geometry module: pattern definitions, their evaluation, SVG output (ADR 0004),
// label placement for views, projects of several parts with their layout (ADR 0007),
// cutting lines with seam allowance (ADR 0009) and the markings drawn with them (ADR 0011).

export type {
  CompiledPattern,
  ComputedCurve,
  ComputedNotch,
  ComputedPattern,
  ComputedPiece,
  CurveDefinition,
  DefinitionError,
  ElementError,
  ElementSource,
  EvaluateOptions,
  NotchDefinition,
  NotchMark,
  OutlineEntry,
  PatternDefinition,
  PatternError,
  PatternInput,
  PatternResult,
  PieceDefinition,
  PointDefinition,
  PointOp,
  ReferenceKind,
  UserOffset,
} from "./types";
export { compilePattern, evaluatePattern } from "./evaluate";
export {
  layoutParts,
  layoutPieces,
  type Offset,
  PART_GAP,
  type PartsLayout,
  PIECE_GAP,
  pointPieces,
  shiftCurve,
} from "./layout";
export {
  type CompiledProject,
  compileProject,
  evaluateProject,
  type ProjectError,
  type ProjectEvaluateOptions,
  type ProjectInput,
  type ProjectPart,
  type ProjectResult,
} from "./project";
export {
  GRAINLINE_ARROW_SIZE,
  grainlineArrowheads,
  LABEL_LINE_HEIGHT,
  type LabelPiece,
  type LabelPlacement,
  placeLabel,
} from "./label";
export {
  type CuttingLineApproximation,
  type CuttingLineError,
  type CuttingLineResult,
  type CuttingPiece,
  cuttingLine,
  DEFAULT_SEAM_ALLOWANCE,
  MAX_SEAM_ALLOWANCE,
  pieceSeamAllowances,
  type SeamAllowances,
} from "./seam-allowance";
export {
  type Bounds,
  curvePathData,
  cuttingLinePathData,
  formatNumber,
  patternBounds,
  piecePathData,
} from "./svg";
export { cuttingLineNotches, NOTCH_LENGTH, NOTCH_PAIR_SPACING } from "./notches";
export {
  MAX_CUT,
  MAX_OUTLINE_ENTRIES,
  MAX_SECTION_ENTRIES,
  PATTERN_FORMAT_VERSION,
  type ValidationResult,
  validateDefinition,
} from "./validate";
export { distance, MAX_COORDINATE, type Point } from "./vector";
