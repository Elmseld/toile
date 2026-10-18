// Public API of the geometry module: pattern definitions, their evaluation and SVG output
// (ADR 0004).

export type {
  ComputedCurve,
  ComputedPattern,
  ComputedPiece,
  CurveDefinition,
  DefinitionError,
  ElementError,
  ElementSource,
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
export { evaluatePattern } from "./evaluate";
export { curvePathData, formatNumber, piecePathData } from "./svg";
export { PATTERN_FORMAT_VERSION, type ValidationResult, validateDefinition } from "./validate";
export { distance, MAX_COORDINATE, type Point } from "./vector";
