// Public API of the geometry module: pattern definitions, their evaluation, SVG output (ADR 0004)
// and label placement for views.

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
  GRAINLINE_ARROW_SIZE,
  type LabelPiece,
  type LabelPlacement,
  placeLabel,
} from "./label";
export { NOTCH_LENGTH, NOTCH_PAIR_SPACING } from "./notches";
export { type Bounds, curvePathData, formatNumber, patternBounds, piecePathData } from "./svg";
export {
  MAX_OUTLINE_ENTRIES,
  MAX_SECTION_ENTRIES,
  PATTERN_FORMAT_VERSION,
  type ValidationResult,
  validateDefinition,
} from "./validate";
export { distance, MAX_COORDINATE, type Point } from "./vector";
