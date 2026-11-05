import { describe, expect, test } from "bun:test";
import { contentStreams, decodePdf, expectWellFormed } from "../../test/support/pdf-check";
import { project, rectangles } from "../../test/support/print-fixtures";
import type { ProjectSeamAllowances } from "../editor/edges";
import { DEFAULT_SEAM_ALLOWANCE } from "../geometry/seam-allowance";
import type { ComputedPattern } from "../geometry/types";
import type { Point } from "../geometry/vector";
import * as engine from "../index";
import { printDrawing } from "./drawing";
import { PRINT_MARGIN, PT_PER_MM, TILE_OVERLAP } from "./paper";
import {
  type PatternPdfInput,
  pageTransform,
  patternPdf,
  pdfPages,
  pieceContent,
  wrapText,
} from "./pdf";
import { pdfText } from "./pdf-writer";
import { printedTiles, tileGrid, tileLabel, tileRect } from "./tiles";

const K = PT_PER_MM;
const DEFAULTS: ProjectSeamAllowances = { default: DEFAULT_SEAM_ALLOWANCE, edges: {} };
const TEXTS = {
  testSquare: "10 × 10 cm",
  scaleCheck: "Print at 100 % (actual size). The square must measure 10 × 10 cm.",
  assembly: "Tape the pages together so that the lines and diamonds meet.",
  overview: "Pages",
};
const SEAM_DASH = "[11.339 5.669] 0 d";

function input(
  parts: Readonly<Record<string, Pick<ComputedPattern, "pieces">>>,
  overrides: Partial<PatternPdfInput> = {},
): PatternPdfInput {
  const base = { allowances: DEFAULTS, labels: {}, title: "Panel", texts: TEXTS };
  return { parts, paper: "a4", ...base, ...overrides };
}

function written(source: PatternPdfInput): { text: string; streams: string[]; pages: number } {
  const result = patternPdf(source);
  if (!result.ok) throw new Error(result.kind);
  const text = decodePdf(result.bytes);
  return { text, streams: contentStreams(text), pages: result.pages };
}

function pagesOf(source: PatternPdfInput) {
  const result = pdfPages(source);
  if (!result.ok) throw new Error(result.kind);
  return result.pages;
}

/** The points of the path that follows `after` in `content`: its `m` point and each op's end. */
function pathAfter(content: string, after: string): Point[] {
  const start = content.indexOf(after);
  expect(start).toBeGreaterThanOrEqual(0);
  const points: Point[] = [];
  let numbers: number[] = [];
  for (const token of content.slice(start + after.length).trim().split(/\s+/)) {
    if (/^-?[\d.]+$/.test(token)) {
      numbers.push(Number(token));
      continue;
    }
    if (token !== "m" && token !== "l" && token !== "c") break;
    points.push({ x: numbers.at(-2)!, y: numbers.at(-1)! });
    numbers = [];
  }
  return points;
}

const length = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

// A 300 × 150 mm rectangle: with the 10 mm allowance 320 mm wide, so two A4 columns.
const PANEL = { panel: rectangles(["panel", 0, 0, 300, 150]) };

describe("patternPdf: scale", () => {
  const { text, streams, pages } = written(input(PANEL));

  test("is a well-formed PDF with page 1 and the two tile pages", () => {
    expectWellFormed(text);
    expect(pages).toBe(3);
    expect(text).toContain("/Count 3");
    expect(streams).toHaveLength(3);
  });

  test("draws the test square on page 1 as a re of exactly 100 mm", () => {
    const match = /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/.exec(streams[0]!);
    expect(match).not.toBeNull();
    expect(Math.abs(Number(match![3]) - (100 * 72) / 25.4)).toBeLessThan(0.01);
    expect(Math.abs(Number(match![4]) - (100 * 72) / 25.4)).toBeLessThan(0.01);
    expect(streams[0]).toContain(pdfText("10 × 10 cm"));
  });

  test("writes A4 and Letter MediaBoxes", () => {
    expect(text).toContain("/MediaBox [0 0 595.276 841.89]");
    const letter = written(input(PANEL, { paper: "letter" })).text;
    expect(letter).toContain("/MediaBox [0 0 612 792]");
    expect(letter).not.toContain("595.276");
  });

  test("draws the 300 mm top edge of the seam line as 300 × 72/25.4 pt", () => {
    const [start, end] = pathAfter(streams[1]!, SEAM_DASH);
    expect(Math.abs(length(start!, end!) - (300 * 72) / 25.4)).toBeLessThan(0.01);
    expect(Math.abs(length(start!, end!) - 850.394)).toBeLessThan(0.01);
  });

  test("puts each pattern point at the same place on neighbouring pages, one step apart", () => {
    const drawing = printDrawing(PANEL, DEFAULTS, {});
    const grid = tileGrid(drawing.bounds!, "a4")!;
    const [a1, a2] = printedTiles(grid, drawing.pieces.map((piece) => piece.region));
    const point = { x: 123.4, y: 56.7 };
    const onA1 = pageTransform(grid, a1!)(point);
    const onA2 = pageTransform(grid, a2!)(point);
    expect(onA1.x - onA2.x).toBeCloseTo(grid.step.x * K, 9);
    expect(onA1.y).toBeCloseTo(onA2.y, 9);
    // The top left of the printable area is PRINT_MARGIN in from the page's top left.
    const corner = pageTransform(grid, a1!)({ x: a1!.rect.minX, y: a1!.rect.minY });
    expect(corner.x).toBeCloseTo(PRINT_MARGIN * K, 9);
    expect(corner.y).toBeCloseTo(841.8898 - PRINT_MARGIN * K, 3);
  });

  test("draws the join line on A1 (right) and A2 (left) at the same pattern x", () => {
    const drawing = printDrawing(PANEL, DEFAULTS, {});
    const grid = tileGrid(drawing.bounds!, "a4")!;
    const patternX = (page: string, col: number): number => {
      const [from, to] = pathAfter(page, "0.3 w 0.4 G");
      expect(from!.x).toBe(to!.x);
      return (from!.x - PRINT_MARGIN * K) / K + tileRect(grid, 0, col).minX;
    };
    const onA1 = patternX(streams[1]!, 0);
    const onA2 = patternX(streams[2]!, 1);
    expect(onA1).toBeCloseTo(onA2, 2);
    expect(onA1).toBeCloseTo(tileRect(grid, 0, 0).maxX - TILE_OVERLAP / 2, 2);
  });
});

describe("pieceContent on the skirt", () => {
  test("draws the centre front at its computed length × 72/25.4 pt", () => {
    const result = project("straight_skirt");
    const part = result.parts.straight_skirt!;
    const drawing = printDrawing(result.parts, DEFAULTS, {});
    const grid = tileGrid(drawing.bounds!, "a4")!;
    const front = drawing.pieces.find((piece) => piece.piece === "front")!;
    // Front outline: f_waist_side_seg, f_dart_leg_side, f_dart_leg_cf, f_waist_cf_seg, f_cf, ...
    expect(front.outline[4]!.name).toBe("f_cf");
    expect(front.outline[4]!.type).toBe("line");
    for (const tile of printedTiles(grid, [front.region])) {
      const path = pathAfter(pieceContent(front, pageTransform(grid, tile)), SEAM_DASH);
      const drawn = length(path[4]!, path[5]!);
      expect(Math.abs(drawn - part.curves.f_cf!.length * K)).toBeLessThan(0.01);
    }
  });
});

describe("pdfPages", () => {
  test("has page 1 and then the printed tiles in reading order, each with its label", () => {
    const result = project("bodice", "straight_sleeve");
    const source = input(result.parts);
    const pages = pagesOf(source);
    const drawing = printDrawing(result.parts, DEFAULTS, {});
    const grid = tileGrid(drawing.bounds!, "a4")!;
    const tiles = printedTiles(grid, drawing.pieces.map((piece) => piece.region));
    expect(pages).toHaveLength(1 + tiles.length);
    expect(pages[0]!.label).toBeNull();
    expect(pages.slice(1).map((page) => page.label)).toEqual(tiles.map((tile) => tile.label));
    for (const page of pages.slice(1)) expect(page.content).toContain(pdfText(page.label!));
    // Page 1's map has one cell per printed tile, with its label.
    for (const tile of tiles) expect(pages[0]!.content).toContain(pdfText(tile.label));
    expectWellFormed(written(source).text);
  });

  test("leaves out a cell only the layout box covers, also from the map", () => {
    // A wide piece along the top and a narrow one below it on the left: B2 is empty.
    const parts = { l: rectangles(["top", 0, 0, 340, 100], ["left", 0, 200, 100, 300]) };
    const pages = pagesOf(input(parts));
    expect(pages.map((page) => page.label)).toEqual([null, "A1", "A2", "B1"]);
    for (const page of pages) expect(page.content).not.toContain(pdfText("B2"));
    // A1 has neighbours to the right and below: two join lines with a diamond each.
    const joins = pages[1]!.content.slice(pages[1]!.content.indexOf("0.3 w 0.4 G"));
    expect(joins.match(/ l S/g)).toHaveLength(2);
    expect(joins.match(/h S/g)).toHaveLength(2);
  });

  test("labels the pieces as given, as hex strings", () => {
    const pages = pagesOf(input(PANEL, { labels: { panel: { panel: "Front)\ncut 2" } } }));
    expect(pages[1]!.content).toContain(pdfText("Front)"));
    expect(pages[1]!.content).toContain(pdfText("cut 2"));
    expect(pages[1]!.content).not.toContain("Front");
  });

  test("puts the title and the texts on page 1", () => {
    const [first] = pagesOf(input(PANEL, { title: "Min kjol" }));
    expect(first!.content).toContain(pdfText("Min kjol"));
    expect(first!.content).toContain(pdfText("Pages"));
    expect(first!.content).toContain("/F2 16 Tf");
  });
});

describe("patternPdf: errors", () => {
  test("is nothing_to_print without parts or pieces", () => {
    expect(patternPdf(input({}))).toEqual({ ok: false, kind: "nothing_to_print" });
    expect(patternPdf(input({ empty: { pieces: {} } }))).toEqual({
      ok: false,
      kind: "nothing_to_print",
    });
  });

  test("is too_many_pages for a pattern far wider than MAX_PRINT_TILES pages, quickly", () => {
    const parts = { wide: rectangles(["near", 0, 0, 10, 10], ["far", 9e6, 0, 10, 10]) };
    const start = performance.now();
    expect(patternPdf(input(parts))).toEqual({ ok: false, kind: "too_many_pages" });
    expect(performance.now() - start).toBeLessThan(500);
  });

  test("is too_many_pages before any label is read", () => {
    const parts = { wide: rectangles(["near", 0, 0, 10, 10], ["far", 9e6, 0, 10, 10]) };
    const labels = {
      get wide(): Record<string, string> {
        throw new Error("labels read before the tile cap");
      },
    };
    expect(patternPdf(input(parts, { labels }))).toEqual({ ok: false, kind: "too_many_pages" });
    // The same labels on a printable pattern are read, and fail.
    expect(patternPdf(input({ wide: rectangles(["near", 0, 0, 10, 10]) }, { labels }))).toEqual({
      ok: false,
      kind: "failed",
    });
  });

  test("is failed when something unexpected throws", () => {
    const parts = {
      get broken(): ComputedPattern {
        throw new Error("boom");
      },
    };
    expect(patternPdf(input(parts))).toEqual({ ok: false, kind: "failed" });
  });

  test("writes a valid PDF whatever the title", () => {
    const { text } = written(input(PANEL, { title: "Kjol ) (\\ \n /Evil 漢" }));
    expectWellFormed(text);
    expect(text).not.toContain("Evil");
  });
});

describe("wrapText", () => {
  test("wraps greedily at the estimated width", () => {
    // At size 10 a character is about 6.2 wide: "aaa bbb" is 43.4, "aaa bbb ccc" 68.2.
    expect(wrapText("aaa bbb ccc", 10, 50)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapText("  aaa   bbb  ", 10, 100)).toEqual(["aaa bbb"]);
  });

  test("keeps an over-long word on its own line", () => {
    expect(wrapText("a verylongword b", 10, 30)).toEqual(["a", "verylongword", "b"]);
  });

  test("gives no lines for empty or blank text", () => {
    expect(wrapText("", 10, 100)).toEqual([]);
    expect(wrapText(" \n ", 10, 100)).toEqual([]);
  });
});

describe("the engine's entry point", () => {
  test("exports the print API", () => {
    expect(engine.patternPdf).toBe(patternPdf);
    expect(engine.readPaper("letter")).toBe("letter");
    expect(engine.tileLabel(1, 2)).toBe(tileLabel(1, 2));
  });
});

describe("patternPdf: page content", () => {
  const FOLD = "[28.346 5.669 5.669 5.669] 0 d";

  test("clips the pattern of a tile page to the printable area, inside the margin", () => {
    const [, page] = pagesOf(input(PANEL));
    const margin = PRINT_MARGIN * K;
    const clip = /q\n([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re W n/.exec(page!.content);
    expect(clip).not.toBeNull();
    const [x, y, w, h] = clip!.slice(1).map(Number) as [number, number, number, number];
    expect(x).toBeCloseTo(margin, 2);
    expect(y).toBeCloseTo(margin, 2);
    expect(x + w).toBeCloseTo(595.276 - margin, 2);
    expect(y + h).toBeCloseTo(841.89 - margin, 2);
    // Every piece drawing comes after the clip, none before it.
    expect(page!.content.indexOf(" re W n")).toBeLessThan(page!.content.indexOf(SEAM_DASH));
  });

  test("clips to Letter's printable area on a Letter page", () => {
    const [, page] = pagesOf(input(PANEL, { paper: "letter" }));
    const margin = PRINT_MARGIN * K;
    const clip = /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re W n/.exec(page!.content)!;
    expect(Number(clip[1]) + Number(clip[3])).toBeCloseTo(612 - margin, 2);
    expect(Number(clip[2]) + Number(clip[4])).toBeCloseTo(792 - margin, 2);
  });

  test("draws a solid cutting line, a dashed seam line, a dash-dot fold and notches on the skirt", () => {
    const result = project("straight_skirt");
    const pages = pagesOf(input(result.parts));
    const tile = pages.slice(1).find((page) => page.content.includes(FOLD));
    expect(tile).toBeDefined();
    const content = tile!.content;
    expect(content).toContain("0.8 w 1 j");
    expect(content).toContain(SEAM_DASH);
    expect(content).toContain("1 J");
    expect(content.indexOf("0.8 w 1 j")).toBeLessThan(content.indexOf(SEAM_DASH));
  });

  test("prints a piece without a cutting line, with no solid cutting path", () => {
    const parts = { only: rectangles(["box", 0, 0, 100, 50]) };
    const allowances = { default: DEFAULT_SEAM_ALLOWANCE, edges: { only: { box_top: 1000 } } };
    const pages = pagesOf(input(parts, { allowances }));
    expect(pages).toHaveLength(2);
    expect(pages[1]!.content).toContain(SEAM_DASH);
    expect(pages[1]!.content).not.toContain("0.8 w 1 j");
  });

  test("gives every tile page of the bodice with sleeve pattern content, so none is empty", () => {
    const pages = pagesOf(input(project("bodice", "straight_sleeve").parts));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages.slice(1)) expect(page.content).toContain(SEAM_DASH);
  });

  test("keeps page 1's test square and map inside the printable area, in A4 and Letter", () => {
    for (const [paper, width, height] of [
      ["a4", 595.276, 841.89],
      ["letter", 612, 792],
    ] as const) {
      const [first] = pagesOf(input(PANEL, { paper }));
      const match = /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/.exec(first!.content)!;
      const [x, y, w, h] = match.slice(1).map(Number) as [number, number, number, number];
      const margin = PRINT_MARGIN * K;
      expect(x).toBeGreaterThanOrEqual(margin - 0.01);
      expect(y).toBeGreaterThanOrEqual(margin - 0.01);
      expect(x + w).toBeLessThanOrEqual(width - margin + 0.01);
      expect(y + h).toBeLessThanOrEqual(height - margin + 0.01);
      expect(first!.content).toContain(pdfText("A1"));
      expect(first!.content).toContain(pdfText("A2"));
    }
  });

  test("lets only the first page carry the title and the test square", () => {
    const pages = pagesOf(input(PANEL, { title: "Unique title" }));
    expect(pages[0]!.content).toContain(pdfText("10 × 10 cm"));
    for (const page of pages.slice(1)) {
      expect(page.content).not.toContain(pdfText("Unique title"));
      expect(page.content).not.toContain(pdfText("10 × 10 cm"));
    }
  });
});
