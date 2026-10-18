// Error values for the formula language. Nothing in the formula code throws: every problem is
// returned as one of these. `message` is English developer text; UI text is built from `kind` and
// the structured fields.

/** 0-based UTF-16 offsets into a formula's source, `end` exclusive. */
export type Span = { start: number; end: number };

/** Where a name was declared in the input to `evaluateFormulas`. */
export type InputSource = "measurement" | "parameter" | "formula";

/**
 * A function call that does not match the function table: an unknown function, the wrong number
 * of arguments, or something other than a bare name where the function takes names.
 */
export type CallError =
  | { kind: "unknown_function"; function: string; span: Span; message: string }
  | {
      kind: "wrong_argument_count";
      function: string;
      min: number;
      max: number | null;
      received: number;
      span: Span;
      message: string;
    }
  | { kind: "invalid_argument"; function: string; span: Span; message: string };

/** Errors from parsing one formula (no formula name yet). */
export type ParseError = { kind: "syntax"; span: Span; message: string } | CallError;

/**
 * Errors from evaluating one expression. `CallError`s only occur for expressions that were not
 * parsed against the same function table (hand-built, or parsed with another table).
 */
export type ExpressionError =
  | CallError
  | { kind: "unknown_reference"; reference: string; span: Span; message: string }
  | { kind: "division_by_zero"; span: Span; message: string }
  | { kind: "invalid_result"; function: string | null; span: Span; message: string };

/** Errors from `evaluateFormulas`. `name` is the formula, measurement or parameter it belongs to. */
export type FormulaError =
  | (ParseError & { name: string })
  | (ExpressionError & { name: string })
  | { kind: "circular_dependency"; name: string; cycle: string[]; span: Span; message: string }
  | { kind: "failed_dependency"; name: string; dependency: string; span: Span; message: string }
  | InvalidNameError<InputSource>
  | DuplicateNameError<InputSource>
  | { kind: "invalid_value"; name: string; source: "measurement" | "parameter"; message: string };

/** A declared name that is not an identifier, once per source it is declared in. */
export type InvalidNameError<S extends string> = {
  kind: "invalid_name";
  name: string;
  source: S;
  message: string;
};

/** A name declared more than once, with every source in declaration order. */
export type DuplicateNameError<S extends string> = {
  kind: "duplicate_name";
  name: string;
  sources: S[];
  message: string;
};

export function syntaxError(message: string, span: Span): ParseError {
  return { kind: "syntax", span, message };
}

export function unknownFunctionError(name: string, span: Span): CallError {
  return { kind: "unknown_function", function: name, span, message: `Unknown function "${name}"` };
}

export function wrongArgumentCountError(
  name: string,
  min: number,
  max: number | null,
  received: number,
  span: Span,
): CallError {
  return {
    kind: "wrong_argument_count",
    function: name,
    min,
    max,
    received,
    span,
    message: `${name}() expects ${describeArity(min, max)}, got ${received}`,
  };
}

export function invalidArgumentError(name: string, span: Span): CallError {
  return {
    kind: "invalid_argument",
    function: name,
    span,
    message: `${name}() expects a name here`,
  };
}

function describeArity(min: number, max: number | null): string {
  if (max === null) return `at least ${pluralArguments(min)}`;
  if (min === max) return pluralArguments(min);
  return `${min} to ${max} arguments`;
}

function pluralArguments(count: number): string {
  return count === 1 ? "1 argument" : `${count} arguments`;
}

export function unknownReferenceError(reference: string, span: Span): ExpressionError {
  return {
    kind: "unknown_reference",
    reference,
    span,
    message: `Unknown name "${reference}"`,
  };
}

export function divisionByZeroError(span: Span): ExpressionError {
  return { kind: "division_by_zero", span, message: "Division by zero" };
}

export function invalidResultError(functionName: string | null, span: Span): ExpressionError {
  const message =
    functionName === null
      ? "Result is not a finite number"
      : `${functionName}() does not give a finite number for these arguments`;
  return { kind: "invalid_result", function: functionName, span, message };
}

export function circularDependencyError(cycle: string[], span: Span): FormulaError {
  return {
    kind: "circular_dependency",
    name: cycle[0] ?? "",
    cycle,
    span,
    message: `Circular dependency: ${cycle.join(" -> ")}`,
  };
}

export function failedDependencyError(
  name: string,
  dependency: string,
  span: Span,
): Extract<FormulaError, { kind: "failed_dependency" }> {
  return {
    kind: "failed_dependency",
    name,
    dependency,
    span,
    message: `"${name}" depends on "${dependency}", which has an error`,
  };
}

export function invalidNameError<S extends string>(name: string, source: S): InvalidNameError<S> {
  return {
    kind: "invalid_name",
    name,
    source,
    message: `"${name}" is not a valid name (use letters, digits and _, not starting with a digit)`,
  };
}

export function duplicateNameError<S extends string>(
  name: string,
  sources: S[],
): DuplicateNameError<S> {
  return {
    kind: "duplicate_name",
    name,
    sources,
    message: `"${name}" is declared more than once (${sources.join(", ")})`,
  };
}

export function invalidValueError(name: string, source: "measurement" | "parameter"): FormulaError {
  return {
    kind: "invalid_value",
    name,
    source,
    message: `The ${source} "${name}" is not a finite number`,
  };
}
