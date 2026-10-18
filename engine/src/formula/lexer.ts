// Tokenizer for the formula language. Hand-written, no regular-expression evaluation of input
// beyond single-character classes, and no `eval`.

import { type ParseError, type Span, syntaxError } from "./errors";

export type Operator = "+" | "-" | "*" | "/";

export type Token =
  | { type: "number"; value: number; span: Span }
  | { type: "identifier"; name: string; span: Span }
  | { type: Operator | "(" | ")" | ","; span: Span }
  | { type: "end"; span: Span };

export type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; error: ParseError };

const PUNCTUATION: ReadonlySet<string> = new Set(["+", "-", "*", "/", "(", ")", ","]);

/**
 * Splits `source` into tokens, each with its span. The last token is always `end` (an empty span
 * at the end of the source). Whitespace (space, tab, CR, LF) is skipped.
 *
 * Numbers are `digits` or `digits.digits`; anything else made of digits and dots (`1.`, `1.2.3`,
 * `.5`) is a syntax error spanning the whole malformed number.
 */
export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < source.length) {
    const char = source.charAt(pos);

    if (isWhitespace(char)) {
      pos++;
      continue;
    }

    if (isDigit(char) || char === ".") {
      const start = pos;
      while (pos < source.length && (isDigit(source.charAt(pos)) || source.charAt(pos) === ".")) {
        pos++;
      }
      const text = source.slice(start, pos);
      const span = { start, end: pos };
      if (!isWellFormedNumber(text)) {
        return { ok: false, error: syntaxError(`Malformed number "${text}"`, span) };
      }
      const value = Number(text);
      if (!Number.isFinite(value)) {
        return { ok: false, error: syntaxError("Number is too large", span) };
      }
      tokens.push({ type: "number", value, span });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = pos;
      pos++;
      while (pos < source.length && isIdentifierPart(source.charAt(pos))) pos++;
      tokens.push({ type: "identifier", name: source.slice(start, pos), span: { start, end: pos } });
      continue;
    }

    if (PUNCTUATION.has(char)) {
      tokens.push({ type: char as Operator | "(" | ")" | ",", span: { start: pos, end: pos + 1 } });
      pos++;
      continue;
    }

    // Report a whole surrogate pair as one character so the span never splits it.
    const width = (source.codePointAt(pos) ?? 0) > 0xffff ? 2 : 1;
    const text = source.slice(pos, pos + width);
    return {
      ok: false,
      error: syntaxError(`Unexpected character "${text}"`, { start: pos, end: pos + width }),
    };
  }

  tokens.push({ type: "end", span: { start: source.length, end: source.length } });
  return { ok: true, tokens };
}

/** True when `name` is a valid identifier: `[A-Za-z_][A-Za-z0-9_]*`. */
export function isIdentifier(name: string): boolean {
  if (name.length === 0 || !isIdentifierStart(name.charAt(0))) return false;
  for (let i = 1; i < name.length; i++) {
    if (!isIdentifierPart(name.charAt(i))) return false;
  }
  return true;
}

function isWellFormedNumber(text: string): boolean {
  const dot = text.indexOf(".");
  if (dot === -1) return true;
  return dot > 0 && dot < text.length - 1 && text.indexOf(".", dot + 1) === -1;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isIdentifierStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || isDigit(char);
}
