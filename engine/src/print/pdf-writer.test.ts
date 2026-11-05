import { describe, expect, test } from "bun:test";
import { contentStreams, decodePdf, expectWellFormed } from "../../test/support/pdf-check";
import { pdfNumber, pdfText, winAnsiBytes, writePdf } from "./pdf-writer";

describe("pdfNumber", () => {
  test("rounds to 3 decimals without trailing zeros, exponent or -0", () => {
    expect(pdfNumber(1 / 3)).toBe("0.333");
    expect(pdfNumber(2.5)).toBe("2.5");
    expect(pdfNumber(100)).toBe("100");
    expect(pdfNumber(-12.3456)).toBe("-12.346");
    expect(pdfNumber(-0.0001)).toBe("0");
    expect(pdfNumber(-0)).toBe("0");
    expect(pdfNumber(1e-7)).toBe("0");
    expect(pdfNumber(1e21)).toBe("1000000000000000000000");
    expect(pdfNumber(-1e21)).toBe("-1000000000000000000000");
    expect(pdfNumber(Number.NaN)).toBe("0");
    expect(pdfNumber(Infinity)).toBe("0");
  });
});

describe("winAnsiBytes", () => {
  test("maps Latin-1 to itself, the Windows-1252 extras to 0x80-0x9F and the rest to ?", () => {
    expect(winAnsiBytes("Åäö×")).toEqual([0xc5, 0xe4, 0xf6, 0xd7]);
    expect(winAnsiBytes("€–")).toEqual([0x80, 0x96]);
    expect(winAnsiBytes("漢\n)")).toEqual([0x3f, 0x3f, 0x29]);
    expect(winAnsiBytes("A ~")).toEqual([0x41, 0x20, 0x7e]);
    // One ? per character, also outside the basic plane, and for DEL and C1 controls.
    expect(winAnsiBytes("😀\u007f\u0085")).toEqual([0x3f, 0x3f, 0x3f]);
  });
});

describe("pdfText", () => {
  test("is a hex string, whatever the text", () => {
    expect(pdfText("a)(\\")).toMatch(/^<[0-9A-F]*>$/);
    expect(pdfText("a)(\\")).toBe("<6129285C>");
    expect(pdfText("")).toBe("<>");
  });
});

describe("writePdf", () => {
  const pages = [
    { width: 595.2756, height: 841.8898, content: "0 0 m 10 10 l S" },
    { width: 612, height: 792, content: "BT /F1 12 Tf 72 72 Td <41> Tj ET" },
  ];
  const text = decodePdf(writePdf({ title: "Kjol ) /Evil\nåäö", pages }));

  test("is well formed: header, xref offsets, startxref and stream lengths", () => {
    // Five fixed objects and two per page, plus entry 0.
    expect(expectWellFormed(text)).toBe(10);
  });

  test("has a page tree with every page, its MediaBox and both fonts", () => {
    expect(text).toContain("/Type /Pages /Kids [6 0 R 8 0 R] /Count 2");
    expect(text).toContain("/MediaBox [0 0 595.276 841.89]");
    expect(text).toContain("/MediaBox [0 0 612 792]");
    expect(text).toContain("/BaseFont /Helvetica /Encoding /WinAnsiEncoding");
    expect(text).toContain("/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding");
    expect(text).toContain("/Font << /F1 3 0 R /F2 4 0 R >>");
    expect(contentStreams(text)).toEqual(pages.map((page) => page.content));
  });

  test("writes the title only as UTF-16BE hex", () => {
    expect(text).not.toContain("Evil");
    expect(text).not.toContain("Kjol");
    const title = /\/Title <([0-9A-F]+)>/.exec(text)!;
    const hex = title[1]!;
    expect(hex.startsWith("FEFF")).toBe(true);
    const units = hex.slice(4).match(/.{4}/g)!.map((unit) => Number.parseInt(unit, 16));
    expect(String.fromCharCode(...units)).toBe("Kjol ) /Evil\nåäö");
    expect(text).toContain("/Producer (Toile)");
  });

  test("measures /Length in bytes, also for content that is not ASCII", () => {
    const pdf = decodePdf(writePdf({ title: "", pages: [{ width: 1, height: 1, content: "é" }] }));
    expect(pdf).toContain("<< /Length 2 >>");
    expectWellFormed(pdf);
  });

  test("writes a document without pages", () => {
    const pdf = decodePdf(writePdf({ title: "", pages: [] }));
    expect(pdf).toContain("/Kids [] /Count 0");
    expect(expectWellFormed(pdf)).toBe(6);
  });
});
