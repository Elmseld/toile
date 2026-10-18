import { describe, expect, test } from "bun:test";
import {
  add,
  angleOf,
  direction,
  distance,
  intersectLineCircle,
  intersectLines,
  norm,
  perpendicularOffset,
  type Point,
  scale,
  sub,
} from "./vector";

const p = (x: number, y: number): Point => ({ x, y });

function expectPoint(actual: Point | null | undefined, x: number, y: number, digits = 9): void {
  expect(actual).not.toBeNull();
  expect(actual?.x).toBeCloseTo(x, digits);
  expect(actual?.y).toBeCloseTo(y, digits);
}

describe("basic vector maths", () => {
  test("distance, add, sub, scale, norm", () => {
    expect(distance(p(0, 0), p(3, 4))).toBe(5);
    expect(distance(p(1, 1), p(1, 1))).toBe(0);
    expect(add(p(1, 2), p(3, 4))).toEqual(p(4, 6));
    expect(sub(p(1, 2), p(3, 5))).toEqual(p(-2, -3));
    expect(scale(p(1, -2), 3)).toEqual(p(3, -6));
    expect(norm(p(-3, 4))).toBe(5);
  });

  test("direction gives exact axis vectors and the SVG angle convention", () => {
    expect(direction(0)).toEqual(p(1, 0));
    expect(direction(90)).toEqual(p(0, 1));
    expect(direction(180)).toEqual(p(-1, 0));
    expect(direction(270)).toEqual(p(0, -1));
    expect(direction(-90)).toEqual(p(0, -1));
    expect(direction(450)).toEqual(p(0, 1));
    expectPoint(direction(30), Math.sqrt(3) / 2, 0.5);
  });
});

describe("angleOf", () => {
  test("the four axis directions", () => {
    expect(angleOf(p(0, 0), p(10, 0))).toBe(0);
    expect(angleOf(p(0, 0), p(0, 10))).toBe(90);
    expect(angleOf(p(0, 0), p(-10, 0))).toBe(180);
    expect(angleOf(p(0, 0), p(0, -10))).toBe(270);
  });

  test("is normalised to [0, 360)", () => {
    expect(angleOf(p(0, 0), p(1, -1))).toBeCloseTo(315, 9);
    expect(angleOf(p(0, 0), p(1, 1))).toBeCloseTo(45, 9);
    // atan2 of a tiny negative dy is a tiny negative angle; + 360 must not give 360.
    const angle = angleOf(p(0, 0), p(1e6, -1e-300));
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(360);
    expect(Object.is(angleOf(p(0, 0), p(5, -0)), -0)).toBe(false);
  });

  test("coincident points give NaN", () => {
    expect(angleOf(p(2, 3), p(2, 3))).toBeNaN();
  });
});

describe("perpendicularOffset", () => {
  test("positive is down for a rightward line and left for a downward line", () => {
    expectPoint(perpendicularOffset(p(0, 0), p(10, 0), 5), 0, 5);
    expectPoint(perpendicularOffset(p(0, 0), p(0, 10), 5), -5, 0);
    expectPoint(perpendicularOffset(p(0, 0), p(10, 0), -5), 0, -5);
  });

  test("coincident points give null", () => {
    expect(perpendicularOffset(p(1, 1), p(1, 1), 5)).toBeNull();
  });
});

describe("intersectLines", () => {
  test("crossing lines", () => {
    expectPoint(intersectLines(p(0, 0), p(10, 10), p(0, 10), p(10, 0)), 5, 5);
    // The intersection may lie outside both segments: the lines are infinite.
    expectPoint(intersectLines(p(0, 0), p(1, 0), p(5, 1), p(5, 2)), 5, 0);
  });

  test("parallel and collinear lines give null", () => {
    expect(intersectLines(p(0, 0), p(10, 0), p(0, 1), p(10, 1))).toBeNull();
    expect(intersectLines(p(0, 0), p(10, 0), p(20, 0), p(30, 0))).toBeNull();
  });

  test("nearly parallel within the tolerance counts as parallel; outside it intersects", () => {
    expect(intersectLines(p(0, 0), p(1000, 0), p(0, 1), p(1000, 1 + 1e-10))).toBeNull();
    expectPoint(intersectLines(p(0, 0), p(1000, 0), p(0, 1), p(1000, 0.5)), 2000, 0, 6);
  });

  test("a line with coincident points gives null", () => {
    expect(intersectLines(p(0, 0), p(0, 0), p(0, 1), p(10, 1))).toBeNull();
  });
});

describe("intersectLineCircle", () => {
  test("two hits ordered by the parameter along the line", () => {
    const hits = intersectLineCircle(p(-20, 0), p(20, 0), p(0, 0), 10);
    expectPoint(hits?.[0], -10, 0);
    expectPoint(hits?.[1], 10, 0);
    const reversed = intersectLineCircle(p(20, 0), p(-20, 0), p(0, 0), 10);
    expectPoint(reversed?.[0], 10, 0);
    expectPoint(reversed?.[1], -10, 0);
  });

  test("a line that does not pass through the center", () => {
    const hits = intersectLineCircle(p(0, 6), p(1, 6), p(0, 0), 10);
    expectPoint(hits?.[0], -8, 6);
    expectPoint(hits?.[1], 8, 6);
  });

  test("a tangent gives the same point twice", () => {
    const hits = intersectLineCircle(p(-5, 10), p(5, 10), p(0, 0), 10);
    expectPoint(hits?.[0], 0, 10);
    expectPoint(hits?.[1], 0, 10);
  });

  test("the tangent tolerance is in mm, also for a large radius", () => {
    // 0.5 nm outside a 1 m circle: within EPSILON in mm, although r^2 - offset^2 is about -1e-6.
    const near = intersectLineCircle(p(-5, 1000 + 5e-10), p(5, 1000 + 5e-10), p(0, 0), 1000);
    expectPoint(near?.[0], 0, 1000);
    expectPoint(near?.[1], 0, 1000);
    // An exact tangent to a 1 m circle at 30 degrees, built with rounding in every coordinate.
    const angle = Math.PI / 6;
    const touch = p(1000 * Math.cos(angle), 1000 * Math.sin(angle));
    const along = p(-Math.sin(angle), Math.cos(angle));
    const tangent = intersectLineCircle(
      p(touch.x - 300 * along.x, touch.y - 300 * along.y),
      p(touch.x + 700 * along.x, touch.y + 700 * along.y),
      p(0, 0),
      1000,
    );
    expectPoint(tangent?.[0], touch.x, touch.y, 4);
    expectPoint(tangent?.[1], touch.x, touch.y, 4);
    // Clearly outside is still a miss.
    expect(intersectLineCircle(p(-5, 1000 + 1e-6), p(5, 1000 + 1e-6), p(0, 0), 1000)).toBeNull();
  });

  test("a miss, a negative radius and a degenerate line give null", () => {
    expect(intersectLineCircle(p(0, 11), p(1, 11), p(0, 0), 10)).toBeNull();
    expect(intersectLineCircle(p(-1, 0), p(1, 0), p(0, 0), -1)).toBeNull();
    expect(intersectLineCircle(p(1, 1), p(1, 1), p(0, 0), 10)).toBeNull();
  });

  test("a zero radius with the center on the line gives the center", () => {
    const hits = intersectLineCircle(p(0, 0), p(10, 10), p(3, 3), 0);
    expectPoint(hits?.[0], 3, 3);
    expectPoint(hits?.[1], 3, 3);
  });
});
