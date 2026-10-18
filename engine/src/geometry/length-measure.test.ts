import { describe, expect, test } from "bun:test";
import { cubicLength } from "./bezier";
import { evaluatePattern } from "./evaluate";

const start = (name: string, x: string, y: string, extra: Record<string, unknown> = {}) => ({
  name,
  op: "start",
  x,
  y,
  ...extra,
});

/** A bodice-like definition with an armhole cubic whose control points can be moved by the user. */
const bodice = (c1Offset?: { dx: number; dy: number }) => ({
  version: 1,
  points: [
    start("A", "0", "0"),
    start("B", "100", "0"),
    start("C1", "0", "100", c1Offset ? { user_offset: c1Offset } : {}),
    start("C2", "100", "100"),
  ],
  curves: [{ name: "armhole", type: "cubic", from: "A", c1: "C1", c2: "C2", to: "B" }],
  formulas: { armhole_len: "length(armhole)" },
});

describe("length() of a cubic, end to end", () => {
  test("the armhole formula equals the arc length of the computed cubic", () => {
    const result = evaluatePattern(bodice(), { measurements: {} });
    const expected = cubicLength({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 });
    expect(result.ok).toBe(true);
    expect(result.values.armhole_len).toBe(expected);
    expect(result.curves.armhole?.length).toBe(expected);
    expect(expected).toBeGreaterThan(100);
  });

  test("a user offset on a control point changes the measured length", () => {
    const plain = evaluatePattern(bodice(), { measurements: {} });
    const moved = evaluatePattern(bodice({ dx: 0, dy: 50 }), { measurements: {} });
    expect(moved.values.armhole_len).toBeGreaterThan(plain.values.armhole_len as number);
    expect(moved.values.armhole_len).toBe(
      cubicLength({ x: 0, y: 0 }, { x: 0, y: 150 }, { x: 100, y: 100 }, { x: 100, y: 0 }),
    );
  });

  test("another pattern can take the measured length as a measurement", () => {
    const first = evaluatePattern(bodice(), { measurements: {} });
    const armhole = first.values.armhole_len as number;
    const sleeve = {
      version: 1,
      measurements: ["armhole"],
      parameters: { ease: 20 },
      points: [
        start("S", "0", "0"),
        { name: "T", op: "along_angle", from: "S", angle: "0", distance: "armhole + ease" },
      ],
    };
    const second = evaluatePattern(sleeve, { measurements: { armhole } });
    expect(second.ok).toBe(true);
    expect(second.points.T).toEqual({ x: armhole + 20, y: 0 });
  });

  test("a cubic whose control point cannot be computed gives no length", () => {
    const broken = bodice();
    (broken.points[2] as Record<string, unknown>).y = "1 / 0";
    const result = evaluatePattern(broken, { measurements: {} });
    expect(result.ok).toBe(false);
    expect(result.values.armhole_len).toBeUndefined();
    expect(result.curves.armhole).toBeUndefined();
  });
});
