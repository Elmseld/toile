// A minimal PDF 1.4 writer (docs/adr/0012-pdf-printing.md): a catalog, a page tree, the base-14
// fonts Helvetica (/F1) and Helvetica-Bold (/F2) in WinAnsiEncoding (not embedded), an info
// dictionary, and one page with one uncompressed content stream per page, indexed by an xref table
// of byte offsets. The caller writes the content streams; text in them goes through `pdfText`, a
// hex string, so no user text can end a string or inject an operator.

/** One page: its size in points and its content stream (ASCII; see `pdfNumber` and `pdfText`). */
export type PdfPage = { width: number; height: number; content: string };

/** The document: `title` goes into the info dictionary, `pages` in order. */
export type PdfDocument = { title: string; pages: readonly PdfPage[] };

// Objects 1 to 5 are fixed; page n (from 0) is object 6 + 2n and its content stream 7 + 2n.
const CATALOG = 1;
const PAGE_TREE = 2;
const FONT_REGULAR = 3;
const FONT_BOLD = 4;
const INFO = 5;
const FIRST_PAGE = 6;

// Values this large are written as integers: below it `toFixed` never uses an exponent.
const INTEGER_FROM = 1e15;

/**
 * `value` as a PDF number: rounded to at most 3 decimals, without trailing zeros, exponent or
 * `-0`. Very large values are written as whole numbers; `NaN` and infinities give `"0"`.
 */
export function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= INTEGER_FROM) return BigInt(Math.round(value)).toString();
  const text = value.toFixed(3).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

// The Windows-1252 characters in 0x80-0x9F, by Unicode code point.
const WIN_ANSI_EXTRAS: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

const QUESTION_MARK = 0x3f;

/**
 * The WinAnsi bytes of `text`, one per character (code point): printable ASCII and Latin-1
 * (0xA0-0xFF, which has å, ä, ö and ×) map to themselves, the Windows-1252 extras (€, the curly
 * quotes, dashes, …) to 0x80-0x9F, and anything else, control characters included, to `?`.
 */
export function winAnsiBytes(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else bytes.push(WIN_ANSI_EXTRAS.get(code) ?? QUESTION_MARK);
  }
  return bytes;
}

/** `text` as a PDF hex string of its WinAnsi bytes, for `Tj` with the /F1 or /F2 font. */
export function pdfText(text: string): string {
  return `<${winAnsiBytes(text).map(hexByte).join("")}>`;
}

/** The PDF of `document`: header, objects, xref table and trailer. Pure; deterministic. */
export function writePdf(document: PdfDocument): Uint8Array {
  const out = new ByteWriter();
  const offsets: number[] = [];
  const object = (number: number, body: string): void => {
    offsets[number] = out.length;
    out.text(`${number} 0 obj\n${body}\nendobj\n`);
  };

  // A comment with bytes above 127 tells transfer tools the file is binary.
  out.text("%PDF-1.4\n");
  out.bytes([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

  const pageNumbers = document.pages.map((_, i) => FIRST_PAGE + 2 * i);
  object(CATALOG, `<< /Type /Catalog /Pages ${PAGE_TREE} 0 R >>`);
  const kids = pageNumbers.map((number) => `${number} 0 R`).join(" ");
  object(PAGE_TREE, `<< /Type /Pages /Kids [${kids}] /Count ${document.pages.length} >>`);
  object(FONT_REGULAR, font("Helvetica"));
  object(FONT_BOLD, font("Helvetica-Bold"));
  object(INFO, `<< /Title ${utf16Text(document.title)} /Producer (Toile) >>`);
  document.pages.forEach((page, i) => {
    const number = pageNumbers[i]!;
    const box = `[0 0 ${pdfNumber(page.width)} ${pdfNumber(page.height)}]`;
    const resources = `<< /Font << /F1 ${FONT_REGULAR} 0 R /F2 ${FONT_BOLD} 0 R >> >>`;
    object(
      number,
      `<< /Type /Page /Parent ${PAGE_TREE} 0 R /MediaBox ${box} /Resources ${resources} ` +
        `/Contents ${number + 1} 0 R >>`,
    );
    const content = new TextEncoder().encode(page.content);
    offsets[number + 1] = out.length;
    out.text(`${number + 1} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
    out.bytes(content);
    out.text("\nendstream\nendobj\n");
  });

  const size = FIRST_PAGE + 2 * document.pages.length;
  const xref = out.length;
  out.text(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let number = 1; number < size; number++) {
    out.text(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  out.text(
    `trailer\n<< /Size ${size} /Root ${CATALOG} 0 R /Info ${INFO} 0 R >>\n` +
      `startxref\n${xref}\n%%EOF\n`,
  );
  return out.result();
}

function font(name: string): string {
  return `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
}

/** A text string for the info dictionary: UTF-16BE hex with a byte order mark, any character. */
function utf16Text(text: string): string {
  let hex = "FEFF";
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return `<${hex}>`;
}

function hexByte(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, "0");
}

/** Collects the file's bytes and knows its length, for the xref offsets. */
class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private readonly encoder = new TextEncoder();
  length = 0;

  text(text: string): void {
    this.bytes(this.encoder.encode(text));
  }

  bytes(bytes: Uint8Array | readonly number[]): void {
    const chunk = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  result(): Uint8Array {
    const all = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      all.set(chunk, at);
      at += chunk.length;
    }
    return all;
  }
}
