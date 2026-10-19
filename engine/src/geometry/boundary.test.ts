import { describe, expect, test } from "bun:test";
import { cleanLoop, findCrossings, leftmostIndex, outerBoundary, polygonsCross } from "./boundary";
import { type Point } from "./vector";

const p = (x: number, y: number): Point => ({ x, y });

function expectPoint(actual: Point | undefined, x: number, y: number, digits = 9): void {
  expect(actual).toBeDefined();
  expect(actual?.x).toBeCloseTo(x, digits);
  expect(actual?.y).toBeCloseTo(y, digits);
}

function expectPoints(actual: readonly Point[], expected: readonly Point[], digits = 9): void {
  expect(actual.length).toBe(expected.length);
  expected.forEach((point, i) => expectPoint(actual[i], point.x, point.y, digits));
}

describe("findCrossings and outerBoundary (D)", () => {
  test("an already simple loop is unchanged", () => {
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    expect(findCrossings(square)).toEqual([]);
    expect(outerBoundary(square)).toEqual(square);
    expect(outerBoundary([p(0, 0), p(1, 0)])).toBeNull();
  });

  test("a reversed lobe of a figure eight is removed", () => {
    const loop = [
      p(0, 0),
      p(100, 0),
      p(100, 100),
      p(70, 100),
      p(40, 130),
      p(60, 130),
      p(30, 100),
      p(0, 100),
    ];
    expect(findCrossings(loop).length).toBe(1);
    expectPoints(outerBoundary(loop) ?? [], [
      p(0, 0),
      p(100, 0),
      p(100, 100),
      p(70, 100),
      p(50, 120),
      p(30, 100),
      p(0, 100),
    ]);
  });

  test("a swallowtail is cut off at its crossing", () => {
    const loop = [p(0, 0), p(60, 10), p(40, 10), p(100, 0), p(100, 100), p(0, 100)];
    expectPoints(outerBoundary(loop) ?? [], [
      p(0, 0),
      p(50, 25 / 3),
      p(100, 0),
      p(100, 100),
      p(0, 100),
    ]);
  });

  test("two overlapping lobes give the outline of their union", () => {
    const loop = [
      p(-15, -15),
      p(55, -15),
      p(55, 70),
      p(45, 70),
      p(45, -5),
      p(115, -5),
      p(115, 115),
      p(-15, 115),
    ];
    expectPoints(outerBoundary(loop) ?? [], [
      p(-15, -15),
      p(55, -15),
      p(55, -5),
      p(115, -5),
      p(115, 115),
      p(-15, 115),
    ]);
  });

  test("starts at the leftmost vertex, also when the loop does not", () => {
    const loop = [
      p(100, 0),
      p(100, 100),
      p(70, 100),
      p(40, 130),
      p(60, 130),
      p(30, 100),
      p(0, 100),
      p(0, 0),
    ];
    expect(outerBoundary(loop)?.[0]).toEqual(p(0, 0));
    expect(leftmostIndex([p(1, 5), p(0, 3), p(0, 2), p(4, 0)])).toBe(2);
    expect(leftmostIndex([])).toBe(0);
  });

  test("a crossing through a vertex is found once", () => {
    // The vertex (50, 50) of the second strand lies exactly on the first one.
    const loop = [p(0, 0), p(100, 100), p(100, 0), p(50, 50), p(0, 100)];
    expect(findCrossings(loop).length).toBe(1);
  });
});

describe("cleanLoop", () => {
  test("merges coincident points, across the seam too, and removes straight points and spikes", () => {
    expect(cleanLoop([p(0, 0), p(10, 0), p(10, 0), p(10, 10), p(0, 10), p(0, 0)])).toEqual([
      p(0, 0),
      p(10, 0),
      p(10, 10),
      p(0, 10),
    ]);
    // A needle out to (20, 5) and back.
    expect(
      cleanLoop([p(0, 0), p(10, 0), p(10, 5), p(20, 5), p(10, 5), p(10, 10), p(0, 10)]),
    ).toEqual([p(0, 0), p(10, 0), p(10, 10), p(0, 10)]);
    // Spikes at the seam: at the last point and at the first.
    expect(cleanLoop([p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(0, 20)])).toEqual([
      p(0, 0),
      p(10, 0),
      p(10, 10),
      p(0, 10),
    ]);
    expect(cleanLoop([p(-10, 0), p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(0, 0)]).length).toBe(4);
  });
});

describe("polygonsCross", () => {
  test("counts crossings between the polygons, not touches or overlaps", () => {
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    expect(polygonsCross(square, [p(5, 5), p(15, 5), p(15, 6)])).toBe(true);
    expect(polygonsCross(square, [p(2, 2), p(8, 2), p(8, 8)])).toBe(false);
    expect(polygonsCross(square, square)).toBe(false);
  });
});
