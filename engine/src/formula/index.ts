// Public API of the formula language (ADR 0003).

export type {
  ExpressionError,
  FormulaError,
  InputSource,
  ParseError,
  Span,
} from "./errors";
export { type ExpressionResult, evaluateExpression } from "./evaluate";
export { type EvaluationResult, type FormulaInput, evaluateFormulas } from "./formulas";
export { FUNCTIONS, type FunctionSpec } from "./functions";
export {
  type Expr,
  MAX_FORMULA_LENGTH,
  MAX_NESTING_DEPTH,
  type ParseResult,
  parseFormula,
  references,
} from "./parser";
