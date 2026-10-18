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
export { PATTERN_FORMAT_VERSION, type ValidationResult, validateDefinition } from "./validate";
export { distance, type Point } from "./vector";
