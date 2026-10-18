// Recursive-descent parser for the formula language (ADR 0003):
//
//   formula    := expression EOF
//   expression := term (("+" | "-") term)*
//   term       := unary (("*" | "/") unary)*
//   unary      := "-" unary | primary
//   primary    := NUMBER | IDENT "(" arguments? ")" | IDENT | "(" expression ")"
//   arguments  := expression ("," expression)*

import {
  invalidArgumentError,
  type ParseError,
  type Span,
  syntaxError,
  unknownFunctionError,
  wrongArgumentCountError,
} from "./errors";
import { FUNCTIONS, type FunctionTable } from "./functions";
import { type Operator, type Token, tokenize } from "./lexer";

/** Parsed formula. Every node carries the span of the source it was parsed from. */
export type Expr =
  | { type: "number"; value: number; span: Span }
  | { type: "reference"; name: string; span: Span }
  | { type: "negate"; operand: Expr; span: Span }
  | { type: "binary"; op: Operator; left: Expr; right: Expr; span: Span }
  | { type: "call"; function: string; args: Expr[]; span: Span };

export type ParseResult = { ok: true; expr: Expr } | { ok: false; error: ParseError };

/** Options for `parseFormula` and `evaluateExpression`. */
export type FormulaOptions = {
  /** The functions a formula may call. Defaults to the built-in `FUNCTIONS`. */
  functions?: FunctionTable;
};

/** Longer formulas are rejected before tokenizing, which bounds the AST size. */
export const MAX_FORMULA_LENGTH = 10_000;

/**
 * Maximum nesting of parenthesized groups, call arguments and unary minus. Bounds the parser's
 * recursion so hostile input cannot overflow the stack.
 */
export const MAX_NESTING_DEPTH = 100;

type Step<T> = { ok: true; value: T } | { ok: false; error: ParseError };

/**
 * Parses one formula into an `Expr`. Never throws: every problem, including over-long or
 * too deeply nested input, comes back as a `ParseError`. Function names, argument counts and
 * name arguments are checked here against `options.functions` (default `FUNCTIONS`); evaluate the
 * result with the same table.
 */
export function parseFormula(source: string, options: FormulaOptions = {}): ParseResult {
  if (source.length > MAX_FORMULA_LENGTH) {
    return fail(syntaxError("Formula is too long", { start: 0, end: source.length }));
  }

  const tokenized = tokenize(source);
  if (!tokenized.ok) return tokenized;

  const tokens = tokenized.tokens;
  if (tokens.length === 1) {
    return fail(syntaxError("Empty formula", { start: 0, end: source.length }));
  }

  const parser = new Parser(tokens, options.functions ?? FUNCTIONS);
  const result = parser.expression();
  if (!result.ok) return result;

  const next = parser.peek();
  if (next.type !== "end") return fail(unexpectedToken(next));

  return { ok: true, expr: result.value };
}

/**
 * The distinct names `expr` refers to (not function names), in order of first appearance, each
 * with the span of its first occurrence.
 */
export function references(expr: Expr): { name: string; span: Span }[] {
  const seen = new Set<string>();
  const result: { name: string; span: Span }[] = [];
  // Iterative pre-order walk; children are pushed in reverse so they pop left to right.
  const stack: Expr[] = [expr];

  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    switch (node.type) {
      case "number":
        break;
      case "reference":
        if (!seen.has(node.name)) {
          seen.add(node.name);
          result.push({ name: node.name, span: node.span });
        }
        break;
      case "negate":
        stack.push(node.operand);
        break;
      case "binary":
        stack.push(node.right, node.left);
        break;
      case "call":
        for (let i = node.args.length - 1; i >= 0; i--) {
          const arg = node.args[i];
          if (arg !== undefined) stack.push(arg);
        }
        break;
    }
  }

  return result;
}

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly functions: FunctionTable,
  ) {}

  peek(): Token {
    // The token list always ends with `end` and `advance` never moves past it.
    return this.tokens[this.pos] ?? this.endToken();
  }

  expression(): Step<Expr> {
    const first = this.term();
    if (!first.ok) return first;
    let left = first.value;

    for (let op = this.peek(); op.type === "+" || op.type === "-"; op = this.peek()) {
      this.advance();
      const right = this.term();
      if (!right.ok) return right;
      left = binary(op.type, left, right.value);
    }

    return ok(left);
  }

  private term(): Step<Expr> {
    const first = this.unary();
    if (!first.ok) return first;
    let left = first.value;

    for (let op = this.peek(); op.type === "*" || op.type === "/"; op = this.peek()) {
      this.advance();
      const right = this.unary();
      if (!right.ok) return right;
      left = binary(op.type, left, right.value);
    }

    return ok(left);
  }

  private unary(): Step<Expr> {
    const token = this.peek();
    if (token.type !== "-") return this.primary();

    return this.nested(token, () => {
      this.advance();
      const operand = this.unary();
      if (!operand.ok) return operand;
      return ok({
        type: "negate",
        operand: operand.value,
        span: { start: token.span.start, end: operand.value.span.end },
      });
    });
  }

  private primary(): Step<Expr> {
    const token = this.peek();

    switch (token.type) {
      case "number":
        this.advance();
        return ok({ type: "number", value: token.value, span: token.span });

      case "identifier":
        this.advance();
        if (this.peek().type === "(") return this.call(token.name, token.span);
        return ok({ type: "reference", name: token.name, span: token.span });

      case "(":
        return this.nested(token, () => {
          this.advance();
          const inner = this.expression();
          if (!inner.ok) return inner;
          const close = this.expect(")");
          if (!close.ok) return close;
          // The group's span includes its parentheses, so errors point at what the user wrote.
          return ok({ ...inner.value, span: { start: token.span.start, end: close.value.span.end } });
        });

      default:
        return fail(unexpectedToken(token));
    }
  }

  private call(name: string, nameSpan: Span): Step<Expr> {
    const spec = this.functions.get(name);
    if (spec === undefined) return fail(unknownFunctionError(name, nameSpan));

    const open = this.peek();
    return this.nested(open, () => {
      this.advance();
      const args: Expr[] = [];

      if (this.peek().type !== ")") {
        for (;;) {
          const arg = this.expression();
          if (!arg.ok) return arg;
          args.push(arg.value);
          if (this.peek().type !== ",") break;
          this.advance();
        }
      }

      const close = this.expect(")");
      if (!close.ok) return close;

      const span = { start: nameSpan.start, end: close.value.span.end };
      if (args.length < spec.min || (spec.max !== null && args.length > spec.max)) {
        return fail(wrongArgumentCountError(name, spec.min, spec.max, args.length, span));
      }
      if (spec.takes === "names") {
        const notName = args.find((arg) => arg.type !== "reference");
        if (notName !== undefined) return fail(invalidArgumentError(name, notName.span));
      }
      return ok({ type: "call", function: name, args, span });
    });
  }

  /** Runs `parse` one nesting level deeper, failing at `token` when the limit is exceeded. */
  private nested(token: Token, parse: () => Step<Expr>): Step<Expr> {
    if (this.depth >= MAX_NESTING_DEPTH) {
      return fail(syntaxError("Formula is nested too deeply", token.span));
    }
    this.depth++;
    const result = parse();
    this.depth--;
    return result;
  }

  private expect(type: ")"): Step<Token> {
    const token = this.peek();
    if (token.type === type) {
      this.advance();
      return { ok: true, value: token };
    }
    if (token.type === "end") {
      return fail(syntaxError('Missing ")" at end of formula', token.span));
    }
    return fail(unexpectedToken(token));
  }

  private advance(): void {
    if (this.pos < this.tokens.length - 1) this.pos++;
  }

  private endToken(): Token {
    const last = this.tokens[this.tokens.length - 1];
    const end = last?.span.end ?? 0;
    return { type: "end", span: { start: end, end } };
  }
}

function binary(op: Operator, left: Expr, right: Expr): Expr {
  return { type: "binary", op, left, right, span: { start: left.span.start, end: right.span.end } };
}

function unexpectedToken(token: Token): ParseError {
  if (token.type === "end") return syntaxError("Unexpected end of formula", token.span);
  return syntaxError(`Unexpected ${describe(token)}`, token.span);
}

function describe(token: Token): string {
  switch (token.type) {
    case "number":
      return `number ${token.value}`;
    case "identifier":
      return `name "${token.name}"`;
    default:
      return `"${token.type}"`;
  }
}

function ok<T>(value: T): Step<T> {
  return { ok: true, value };
}

function fail(error: ParseError): { ok: false; error: ParseError } {
  return { ok: false, error };
}
