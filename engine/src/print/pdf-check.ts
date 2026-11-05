// Structural checks of a written PDF for the print tests (not part of the engine's API).

import { expect } from "bun:test";

/** The PDF bytes as a string of one character per byte, so string offsets are byte offsets. */
export function decodePdf(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

/**
 * Asserts that `text` (a decoded PDF) is well formed: the header, an xref entry per object
 * pointing at `n 0 obj`, `startxref` at the xref table and each stream's `/Length` its byte length.
 * Returns the number of objects.
 */
export function expectWellFormed(text: string): number {
  expect(text.startsWith("%PDF-1.4\n")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const start = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
  expect(start).not.toBeNull();
  const xref = Number(start![1]);
  expect(text.slice(xref, xref + 5)).toBe("xref\n");
  const header = /^xref\n0 (\d+)\n/.exec(text.slice(xref))!;
  const size = Number(header[1]);
  const entries = text.slice(xref + header[0].length).split("\n").slice(0, size);
  expect(entries[0]).toBe("0000000000 65535 f ");
  for (let number = 1; number < size; number++) {
    const entry = entries[number]!;
    expect(entry).toMatch(/^\d{10} 00000 n $/);
    const offset = Number(entry.slice(0, 10));
    expect(text.slice(offset, offset + `${number} 0 obj`.length)).toBe(`${number} 0 obj`);
  }
  expect(text).toContain(`/Size ${size} `);
  for (const match of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const begin = match.index + match[0].length;
    const length = Number(match[1]);
    expect(text.slice(begin + length, begin + length + "\nendstream".length)).toBe("\nendstream");
  }
  return size;
}

/** The content streams of `text` (a decoded PDF), in page order. */
export function contentStreams(text: string): string[] {
  return [...text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)].map((match) => {
    const begin = match.index + match[0].length;
    return text.slice(begin, begin + Number(match[1]));
  });
}
