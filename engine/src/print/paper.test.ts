import { describe, expect, test } from "bun:test";
import { PAPER_SIZES, PT_PER_MM, readPaper } from "./paper";

describe("readPaper", () => {
  test("is Letter only for \"letter\" and A4 for anything else", () => {
    expect(readPaper("letter")).toBe("letter");
    for (const value of ["a4", "A4", "Letter", "", undefined, null, 4, {}]) {
      expect(readPaper(value)).toBe("a4");
    }
  });
});

describe("paper sizes", () => {
  test("are A4 and US Letter in mm, portrait", () => {
    expect(PAPER_SIZES.a4).toEqual({ width: 210, height: 297 });
    expect(PAPER_SIZES.letter).toEqual({ width: 215.9, height: 279.4 });
    expect(PAPER_SIZES.letter.width * PT_PER_MM).toBeCloseTo(612, 9);
    expect(PAPER_SIZES.letter.height * PT_PER_MM).toBeCloseTo(792, 9);
  });
});
