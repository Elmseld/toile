import { describe, expect, test } from "bun:test";
import { isIdentifier, tokenize } from "./lexer";

function tokens(source: string) {
  const result = tokenize(source);
  if (!result.ok) throw new Error(`unexpected error: ${result.error.message}`);
  return result.tokens;
}

describe("tokenize", () => {
  test("numbers with and without a fraction", () => {
    expect(tokens("12 12.5")).toEqual([
      { type: "number", value: 12, span: { start: 0, end: 2 } },
      { type: "number", value: 12.5, span: { start: 3, end: 7 } },
      { type: "end", span: { start: 7, end: 7 } },
    ]);
  });

  test("identifiers", () => {
    expect(tokens("waist _a b2_C")).toEqual([
      { type: "identifier", name: "waist", span: { start: 0, end: 5 } },
      { type: "identifier", name: "_a", span: { start: 6, end: 8 } },
      { type: "identifier", name: "b2_C", span: { start: 9, end: 13 } },
      { type: "end", span: { start: 13, end: 13 } },
    ]);
  });

  test("operators and punctuation", () => {
    expect(tokens("+-*/(),").map((t) => [t.type, t.span.start, t.span.end])).toEqual([
      ["+", 0, 1],
      ["-", 1, 2],
      ["*", 2, 3],
      ["/", 3, 4],
      ["(", 4, 5],
      [")", 5, 6],
      [",", 6, 7],
      ["end", 7, 7],
    ]);
  });

  test("whitespace including tabs and newlines is skipped", () => {
    expect(tokens(" \ta\n+\r\n1 ").map((t) => [t.type, t.span.start])).toEqual([
      ["identifier", 2],
      ["+", 4],
      ["number", 7],
      ["end", 9],
    ]);
  });

  test("empty source gives only the end token", () => {
    expect(tokens("")).toEqual([{ type: "end", span: { start: 0, end: 0 } }]);
  });

  test("an unexpected character is a syntax error at that character", () => {
    expect(tokenize("a $ b")).toEqual({
      ok: false,
      error: { kind: "syntax", span: { start: 2, end: 3 }, message: 'Unexpected character "$"' },
    });
  });

  test("a non-BMP character is reported whole", () => {
    const result = tokenize("a 😀");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.span).toEqual({ start: 2, end: 4 });
  });

  test.each(["1.", "1.2.3", ".5", "1..2"])("malformed number %p spans the whole number", (text) => {
    const result = tokenize(`a + ${text}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("syntax");
      expect(result.error.span).toEqual({ start: 4, end: 4 + text.length });
    }
  });

  test("a number too large for a double is a syntax error", () => {
    const result = tokenize("9".repeat(400));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("Number is too large");
  });
});

describe("isIdentifier", () => {
  test("accepts identifiers", () => {
    for (const name of ["a", "_", "waist", "ease_waist", "A1", "__proto__"]) {
      expect(isIdentifier(name)).toBe(true);
    }
  });

  test("rejects everything else", () => {
    for (const name of ["", "1abc", "a-b", "a b", "å", "a.b"]) {
      expect(isIdentifier(name)).toBe(false);
    }
  });
});
