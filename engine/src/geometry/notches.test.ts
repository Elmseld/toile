import { describe, expect, test } from "bun:test";
import { computeNotch, NOTCH_LENGTH, NOTCH_PAIR_SPACING } from "./notches";
import type { ComputedCurve } from "./types";
import { distance, type Point } from "./vector";

const p = (x: number, y: number): Point => ({ x, y });
const line = (from: Point, to: Point): ComputedCurve => ({
  name: "l",
  type: "line",
  from,
  to,
  length: distance(from, to),
});

// A clockwise 100 x 50 rectangle on screen.
const RECTANGLE = [
  line(p(0, 0), p(100, 0)),
  line(p(100, 0), p(100, 50)),
  line(p(100, 50), p(0, 50)),
  line(p(0, 50), p(0, 0)),
];

describe("computeNotch", () => {
  test("the constants", () => {
    expect(NOTCH_LENGTH).toBe(6);
    expect(NOTCH_PAIR_SPACING).toBe(4);
  });

  test("a distance a hair below the perimeter, past every curve by rounding, comes round to the start", () => {
    // Hand-built lengths for which the walk's running subtraction leaves the largest distance below
    // the perimeter at or beyond the last curve.
    const lengths = [11.88, 0.0001, 477.4];
    const outline: ComputedCurve[] = [
      { ...line(p(0, 0), p(10, 0)), length: lengths[0]! },
      { ...line(p(10, 0), p(10, 10)), length: lengths[1]! },
      { ...line(p(10, 10), p(0, 0)), length: lengths[2]! },
    ];
    const notch = computeNotch(outline, { start: 0, distance: 489.28009999999995, marks: 1 });
    expect(notch).toMatchObject({ point: { x: 0, y: 0 } });
  });

  test("a negative, non-finite or too long distance is a message", () => {
    for (const value of [-1, 300, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(typeof computeNotch(RECTANGLE, { start: 0, distance: value, marks: 1 })).toBe("string");
    }
  });

  test("an outline whose curves all have zero length has no place for a notch", () => {
    const point = [line(p(1, 1), p(1, 1))];
    expect(typeof computeNotch(point, { start: 0, distance: 0, marks: 1 })).toBe("string");
  });

  test("a cubic without direction at the notch (all control points on one point) is a message", () => {
    const stuck: ComputedCurve = {
      name: "c",
      type: "cubic",
      from: p(0, 0),
      c1: p(0, 0),
      c2: p(0, 0),
      to: p(0, 0),
      length: 1,
    };
    expect(typeof computeNotch([stuck, line(p(0, 0), p(0, 0))], { start: 0, distance: 0.5, marks: 1 })).toBe(
      "string",
    );
  });

  test("results are fresh objects", () => {
    const a = computeNotch(RECTANGLE, { start: 0, distance: 0, marks: 2 });
    const b = computeNotch(RECTANGLE, { start: 0, distance: 0, marks: 2 });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
