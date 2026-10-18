import { describe, expect, test } from "bun:test";
import { curvePathData, formatNumber, piecePathData } from "./svg";
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

  test("an empty outline (only hand-built) gives an empty string", () => {
    expect(piecePathData({ name: "e", outline: [], grainline: { from: p(0, 0), to: p(0, 1) } })).toBe("");
  });
});
