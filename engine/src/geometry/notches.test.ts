import { describe, expect, test } from "bun:test";
import { computeNotch, cuttingLineNotches, NOTCH_LENGTH, NOTCH_PAIR_SPACING } from "./notches";
import { cuttingLine } from "./seam-allowance";
import type { ComputedCurve, ComputedNotch } from "./types";
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

describe("cuttingLineNotches", () => {
  const notchAt = (start: number, at: number, marks: 1 | 2 = 1): ComputedNotch => {
    const notch = computeNotch(RECTANGLE, { start, distance: at, marks });
    if (typeof notch === "string") throw new Error(notch);
    return notch;
  };
  const lineAt = (allowance: number): Point[] => {
    const result = cuttingLine({ outline: RECTANGLE }, { default: allowance });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.points;
  };
  const expectPoint = (actual: Point, x: number, y: number) => {
    expect(actual.x).toBeCloseTo(x, 9);
    expect(actual.y).toBeCloseTo(y, 9);
  };

  test("at 10 mm the mark starts on the cutting line, 10 mm out, and points inward", () => {
    // On the right edge (going down from (100, 0)), 25 mm down: the mark points left.
    const notch = notchAt(1, 25);
    const [moved] = cuttingLineNotches([notch], lineAt(10));
    expectPoint(moved!.point, 110, 25);
    expect(moved!.marks).toHaveLength(1);
    const [mark] = moved!.marks;
    expectPoint(mark!.from, 110, 25);
    expectPoint(mark!.to, 110 - NOTCH_LENGTH, 25);
  });

  test("at 0 mm the marks stay where they are", () => {
    const notch = notchAt(2, 30);
    const [moved] = cuttingLineNotches([notch], lineAt(0));
    expectPoint(moved!.point, notch.point.x, notch.point.y);
    expectPoint(moved!.marks[0]!.from, notch.marks[0]!.from.x, notch.marks[0]!.from.y);
    expectPoint(moved!.marks[0]!.to, notch.marks[0]!.to.x, notch.marks[0]!.to.y);
  });

  test("a double notch keeps both marks, each moved along its own line", () => {
    // On the top edge (going right), 50 mm along: marks at x = 48 and 52, pointing down.
    const notch = notchAt(0, 50, 2);
    const [moved] = cuttingLineNotches([notch], lineAt(15));
    expect(moved!.marks).toHaveLength(2);
    expectPoint(moved!.point, 50, -15);
    expectPoint(moved!.marks[0]!.from, 50 - NOTCH_PAIR_SPACING / 2, -15);
    expectPoint(moved!.marks[0]!.to, 50 - NOTCH_PAIR_SPACING / 2, -15 + NOTCH_LENGTH);
    expectPoint(moved!.marks[1]!.from, 50 + NOTCH_PAIR_SPACING / 2, -15);
  });

  test("keeps the order of the input", () => {
    const notches = [notchAt(0, 10), notchAt(1, 10), notchAt(3, 10)];
    const moved = cuttingLineNotches(notches, lineAt(10));
    expectPoint(moved[0]!.point, 10, -10);
    expectPoint(moved[1]!.point, 110, 10);
    expectPoint(moved[2]!.point, -10, 40);
  });

  test("a degenerate line, or a mark without direction, keeps the original marks", () => {
    const notch = notchAt(1, 25);
    for (const line of [[], [p(0, 0)], [p(500, 500), p(600, 500)]]) {
      expect(cuttingLineNotches([notch], line)).toEqual([notch]);
    }
    const still: ComputedNotch = {
      point: p(100, 25),
      marks: [{ from: p(100, 25), to: p(100, 25) }],
    };
    expect(cuttingLineNotches([still], lineAt(10))).toEqual([still]);
    const bare: ComputedNotch = { point: p(100, 25), marks: [] };
    expect(cuttingLineNotches([bare], lineAt(10))).toEqual([bare]);
  });
});
