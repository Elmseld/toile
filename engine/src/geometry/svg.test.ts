import { describe, expect, test } from "bun:test";
import {
  curvePathData,
  cuttingLinePathData,
  formatNumber,
  patternBounds,
  piecePathData,
} from "./svg";
import type { ComputedCurve, ComputedPiece } from "./types";
import type { Point } from "./vector";

const p = (x: number, y: number): Point => ({ x, y });
const line = (name: string, from: Point, to: Point): ComputedCurve => ({
  name,
  type: "line",
  from,
  to,
  length: Math.hypot(to.x - from.x, to.y - from.y),
});

describe("formatNumber", () => {
  test("rounds to 0.01 and trims trailing zeros", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(12)).toBe("12");
    expect(formatNumber(12.5)).toBe("12.5");
    expect(formatNumber(200 / 3)).toBe("66.67");
    expect(formatNumber(400 / 3)).toBe("133.33");
    expect(formatNumber(1.999)).toBe("2");
    expect(formatNumber(-3.14159)).toBe("-3.14");
  });

  test("never gives -0", () => {
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(-0.004)).toBe("0");
    expect(formatNumber(-1e-12)).toBe("0");
  });

  test("huge finite values are written unrounded instead of overflowing to Infinity", () => {
    expect(formatNumber(1e307)).toBe("1e+307");
    expect(formatNumber(-Number.MAX_VALUE)).toBe(String(-Number.MAX_VALUE));
  });

  test("non-finite values (only hand-built) give 0", () => {
    expect(formatNumber(Number.NaN)).toBe("0");
    expect(formatNumber(Infinity)).toBe("0");
    expect(formatNumber(-Infinity)).toBe("0");
  });
});

describe("curvePathData", () => {
  test("a line", () => {
    expect(curvePathData(line("a", p(0, 0), p(10.256, -5)))).toBe("M 0 0 L 10.26 -5");
  });

  test("a cubic", () => {
    const curve: ComputedCurve = {
      name: "c",
      type: "cubic",
      from: p(0, 0),
      c1: p(0, 100 / 3),
      c2: p(50, 100),
      to: p(100, 100),
      length: 0,
    };
    expect(curvePathData(curve)).toBe("M 0 0 C 0 33.33 50 100 100 100");
  });

  test("a curve of another type (only hand-built) gives an empty string without throwing", () => {
    const odd = { name: "o", type: "arc", from: p(0, 0), to: p(1, 1), length: 1 };
    expect(curvePathData(odd as unknown as ComputedCurve)).toBe("");
  });
});

describe("piecePathData", () => {
  test("a triangle", () => {
    const [a, b, c] = [p(0, 0), p(100, 0), p(50, 80)];
    const piece: ComputedPiece = {
      name: "t",
      outline: [line("ab", a, b), line("bc", b, c), line("ca", c, a)],
      grainline: { from: c, to: a },
    };
    expect(piecePathData(piece)).toBe("M 0 0 L 100 0 L 50 80 L 0 0 Z");
  });

  test("a piece with a cubic", () => {
    const [a, b] = [p(0, 0), p(100, 0)];
    const piece: ComputedPiece = {
      name: "d",
      outline: [
        line("ab", a, b),
        { name: "ba", type: "cubic", from: b, c1: p(100, 50), c2: p(0, 50), to: a, length: 0 },
      ],
      grainline: { from: a, to: b },
    };
    expect(piecePathData(piece)).toBe("M 0 0 L 100 0 C 100 50 0 50 0 0 Z");
  });

  test("curves of another type (only hand-built) are skipped", () => {
    const [a, b] = [p(0, 0), p(100, 0)];
    const odd = { name: "o", type: "arc", from: b, to: a, length: 1 } as unknown as ComputedCurve;
    const piece: ComputedPiece = { name: "x", outline: [line("ab", a, b), odd], grainline: { from: a, to: b } };
    expect(piecePathData(piece)).toBe("M 0 0 L 100 0 Z");
  });

  test("an empty outline (only hand-built) gives an empty string", () => {
    expect(piecePathData({ name: "e", outline: [], grainline: { from: p(0, 0), to: p(0, 1) } })).toBe("");
  });
});

describe("patternBounds", () => {
  const triangle: ComputedPiece = {
    name: "t",
    outline: [
      line("ab", p(0, 0), p(100, 0)),
      line("bc", p(100, 0), p(50, 80)),
      line("ca", p(50, 80), p(0, 0)),
    ],
    grainline: { from: p(50, 10), to: p(50, 70) },
  };

  test("null without pieces", () => {
    expect(patternBounds({ pieces: {} })).toBeNull();
  });

  test("the box around a piece of lines", () => {
    expect(patternBounds({ pieces: { t: triangle } })).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 80 });
  });

  test("a cubic's control points extend the box", () => {
    const [a, b] = [p(0, 0), p(100, 0)];
    const piece: ComputedPiece = {
      name: "d",
      outline: [
        line("ab", a, b),
        { name: "ba", type: "cubic", from: b, c1: p(120, 50), c2: p(-10, 60), to: a, length: 0 },
      ],
      grainline: { from: p(50, 0), to: p(50, 10) },
    };
    expect(patternBounds({ pieces: { d: piece } })).toEqual({ minX: -10, minY: 0, maxX: 120, maxY: 60 });
  });

  test("grainline points are included", () => {
    const piece: ComputedPiece = { ...triangle, grainline: { from: p(-5, -20), to: p(50, 90) } };
    expect(patternBounds({ pieces: { t: piece } })).toEqual({ minX: -5, minY: -20, maxX: 100, maxY: 90 });
  });

  test("covers every piece", () => {
    const moved: ComputedPiece = {
      name: "m",
      outline: [line("de", p(200, 10), p(300, 10)), line("ed", p(300, 10), p(200, 10))],
      grainline: { from: p(250, 10), to: p(250, 20) },
    };
    expect(patternBounds({ pieces: { t: triangle, m: moved } })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 300,
      maxY: 80,
    });
  });

  test("non-finite numbers (only hand-built) are skipped per axis", () => {
    const piece: ComputedPiece = {
      ...triangle,
      grainline: { from: p(Number.NaN, 500), to: p(Infinity, -Infinity) },
    };
    expect(patternBounds({ pieces: { t: piece } })).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 500 });
  });

  test("null when no coordinate is finite", () => {
    const nan = p(Number.NaN, Number.NaN);
    const piece: ComputedPiece = {
      name: "n",
      outline: [line("nn", nan, nan)],
      grainline: { from: nan, to: nan },
    };
    expect(patternBounds({ pieces: { n: piece } })).toBeNull();
  });
});

describe("cuttingLinePathData", () => {
  test("a closed polygon with rounded numbers and no -0", () => {
    const points = [p(-10, -10), p(210.004, -10), p(210, 110.256), p(-0.001, 110)];
    expect(cuttingLinePathData(points)).toBe("M -10 -10 L 210 -10 L 210 110.26 L 0 110 Z");
  });

  test("two points still close; fewer than two give an empty string", () => {
    expect(cuttingLinePathData([p(0, 0), p(1, 1)])).toBe("M 0 0 L 1 1 Z");
    expect(cuttingLinePathData([p(0, 0)])).toBe("");
    expect(cuttingLinePathData([])).toBe("");
  });
});
