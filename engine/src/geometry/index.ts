// Public API of the geometry module: pattern definitions, their evaluation, SVG output (ADR 0004),
// label placement for views, and projects of several parts with their layout (ADR 0007).

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
export { layoutParts, PART_GAP, type PartsLayout } from "./layout";
export {
  type CompiledProject,
  compileProject,
  evaluateProject,
  type ProjectError,
  type ProjectInput,
  type ProjectPart,
  type ProjectResult,
} from "./project";
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
