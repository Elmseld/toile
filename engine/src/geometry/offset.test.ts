import { describe, expect, test } from "bun:test";
import {
  cubicSegments,
  type Edge,
  edgeTangent,
  flattenEdge,
  MAX_CUBIC_SEGMENTS,
  offsetEdge,
  outwardNormal,
  polygonArea,
  reverseEdge,
} from "./offset";
import { type Point } from "./vector";

const p = (x: number, y: number): Point => ({ x, y });
const line = (from: Point, to: Point): Edge => ({ name: "l", type: "line", from, to });
const cubic = (from: Point, c1: Point, c2: Point, to: Point): Edge => ({
  name: "c",
  type: "cubic",
  from,
  c1,
  c2,
  to,
});

function expectPoint(actual: Point | undefined, x: number, y: number, digits = 9): void {
  expect(actual).toBeDefined();
  expect(actual?.x).toBeCloseTo(x, digits);
  expect(actual?.y).toBeCloseTo(y, digits);
}

function expectPoints(actual: readonly Point[], expected: readonly Point[], digits = 9): void {
  expect(actual.length).toBe(expected.length);
  expected.forEach((point, i) => expectPoint(actual[i], point.x, point.y, digits));
}

/** Turning (degrees, signed) between consecutive segments of an open polyline. */
function turns(points: readonly Point[]): number[] {
  const result: number[] = [];
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const u = { x: b.x - a.x, y: b.y - a.y };
    const v = { x: c.x - b.x, y: c.y - b.y };
    result.push((Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y) * 180) / Math.PI);
  }
  return result;
}

// Quarter circle of radius 100 around the origin, from (100, 0) clockwise on screen to (0, 100),
// with the control distance of least radial error (about 0.02 mm at this radius).
const K = 0.551915024494;
const QUARTER = cubic(p(100, 0), p(100, 100 * K), p(100 * K, 100), p(0, 100));

describe("polygonArea and orientation", () => {
  test("clockwise on screen (y down) is positive", () => {
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    expect(polygonArea(square)).toBe(100);
    expect(polygonArea([...square].reverse())).toBe(-100);
    expect(polygonArea([])).toBe(0);
  });

  test("the outward normal points away from a clockwise and a counter-clockwise outline", () => {
    // Top edge travelling right: outside is up for a clockwise outline, down otherwise.
    expect(outwardNormal(p(1, 0), 1)).toEqual(p(0, -1));
    expect(outwardNormal(p(1, 0), -1)).toEqual(p(-0, 1));
  });

  test("reverseEdge swaps the ends and the controls", () => {
    expect(reverseEdge(line(p(0, 0), p(1, 2)))).toEqual(line(p(1, 2), p(0, 0)));
    expect(reverseEdge(QUARTER)).toEqual(
      cubic(p(0, 100), p(100 * K, 100), p(100, 100 * K), p(100, 0)),
    );
  });
});

describe("offsetEdge (A)", () => {
  test("a line moves both ends along its normal", () => {
    expectPoints(offsetEdge(line(p(0, 0), p(100, 0)), 10, 1), [p(0, -10), p(100, -10)]);
    expectPoints(offsetEdge(line(p(0, 0), p(100, 0)), 10, -1), [p(0, 10), p(100, 10)]);
    expectPoints(offsetEdge(line(p(0, 0), p(30, 40)), 5, 1), [p(4, -3), p(34, 37)]);
    expect(offsetEdge(line(p(1, 1), p(1, 1)), 5, 1)).toEqual([p(1, 1)]);
  });

  test("allowance 0 is the flattened edge", () => {
    const segments = cubicSegments(QUARTER, 0);
    expect(offsetEdge(QUARTER, 0, 1)).toEqual(flattenEdge(QUARTER, segments));
    expect(flattenEdge(line(p(0, 0), p(5, 0)), 7)).toEqual([p(0, 0), p(5, 0)]);
  });

  for (const [side, sign, radius] of [
    ["convex", 1, 110],
    ["concave", -1, 90],
  ] as const) {
    test(`a quarter circle offset on its ${side} side keeps radius ${radius}`, () => {
      const points = offsetEdge(QUARTER, 10, sign);
      expect(points.length).toBe(cubicSegments(QUARTER, 10) + 1);
      for (const point of points)
        expect(Math.abs(Math.hypot(point.x, point.y) - radius)).toBeLessThan(0.03);
      for (let i = 1; i < points.length; i++) {
        const mid = p((points[i - 1]!.x + points[i]!.x) / 2, (points[i - 1]!.y + points[i]!.y) / 2);
        expect(Math.abs(Math.hypot(mid.x, mid.y) - radius)).toBeLessThan(0.05);
      }
      const steps = turns(points);
      expect(steps.every((turn) => turn > 0)).toBe(true);
      expect(Math.max(...steps)).toBeLessThan(10);
    });
  }
});

describe("cubicSegments (B)", () => {
  test("is 1 for a line and for a straight cubic with evenly spaced controls", () => {
    expect(cubicSegments(line(p(0, 0), p(100, 0)), 10)).toBe(1);
    expect(cubicSegments(cubic(p(0, 0), p(10, 0), p(20, 0), p(30, 0)), 40)).toBe(1);
  });

  test("grows with curvature and with the allowance", () => {
    const gentle = cubic(p(0, 0), p(100, 10), p(200, 10), p(300, 0));
    const sharp = cubic(p(0, 0), p(100, 100), p(200, 100), p(300, 0));
    expect(cubicSegments(sharp, 0)).toBeGreaterThan(cubicSegments(gentle, 0));
    // A small curve, where the turning of the normals outweighs its flatness.
    const small = cubic(p(10, 0), p(10, 10 * K), p(10 * K, 10), p(0, 10));
    expect(cubicSegments(small, 40)).toBeGreaterThan(cubicSegments(small, 10));
    expect(cubicSegments(small, 10)).toBeGreaterThanOrEqual(cubicSegments(small, 0));
  });

  test("never exceeds MAX_CUBIC_SEGMENTS, also for huge coordinates", () => {
    const huge = cubic(p(0, 0), p(1e7, -1e7), p(-1e7, 1e7), p(1e7, 1e7));
    expect(cubicSegments(huge, 100)).toBe(MAX_CUBIC_SEGMENTS);
    const overflow = cubic(p(0, 0), p(1e308, -1e308), p(-1e308, 1e308), p(0, 0));
    expect(cubicSegments(overflow, 100)).toBe(MAX_CUBIC_SEGMENTS);
  });

  test("edgeTangent gives the unit direction at either end", () => {
    expect(edgeTangent(line(p(0, 0), p(0, 5)), 0)).toEqual(p(0, 1));
    expectPoint(edgeTangent(QUARTER, 0) ?? undefined, 0, 1);
    expectPoint(edgeTangent(QUARTER, 1) ?? undefined, -1, 0);
    expect(edgeTangent(line(p(1, 1), p(1, 1)), 1)).toBeNull();
  });
});
