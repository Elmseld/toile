// Public API of the formula language (ADR 0003).

export type {
  CallError,
  DuplicateNameError,
  ExpressionError,
  FormulaError,
  InputSource,
  InvalidNameError,
  ParseError,
  Span,
} from "./errors";
export { type ExpressionResult, evaluateExpression } from "./evaluate";
export { type EvaluationResult, type FormulaInput, evaluateFormulas } from "./formulas";
export { FUNCTIONS, type FunctionSpec, type FunctionTable } from "./functions";
export {
  type Expr,
  type FormulaOptions,
  MAX_FORMULA_LENGTH,
  MAX_NESTING_DEPTH,
  type ParseResult,
  parseFormula,
  references,
} from "./parser";
