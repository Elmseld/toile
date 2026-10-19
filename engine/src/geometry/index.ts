// Public API of the geometry module: pattern definitions, their evaluation, SVG output (ADR 0004),
// label placement for views and cutting lines with seam allowance (ADR 0007).

export type {
  CompiledPattern,
  ComputedCurve,
  ComputedPattern,
  ComputedPiece,
  CurveDefinition,
  DefinitionError,
  ElementError,
  ElementSource,
  EvaluateOptions,
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
  GRAINLINE_ARROW_SIZE,
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
  MAX_SEAM_ALLOWANCE,
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
export {
  MAX_OUTLINE_ENTRIES,
  MAX_SECTION_ENTRIES,
  PATTERN_FORMAT_VERSION,
  type ValidationResult,
  validateDefinition,
} from "./validate";
export { distance, MAX_COORDINATE, type Point } from "./vector";
