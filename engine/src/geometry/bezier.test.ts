import { describe, expect, test } from "bun:test";
import { cubicAt, cubicLength } from "./bezier";
import { distance, type Point } from "./vector";

const p = (x: number, y: number): Point => ({ x, y });

/** Reference length: the polyline through `segments + 1` evenly spaced parameter values. */
function polylineLength(p0: Point, p1: Point, p2: Point, p3: Point, segments: number): number {
  let total = 0;
  let previous = p0;
  for (let i = 1; i <= segments; i++) {
    const next = cubicAt(p0, p1, p2, p3, i / segments);
    total += distance(previous, next);
    previous = next;
  }
  return total;
}

describe("cubicAt", () => {
  test("starts at p0, ends at p3 and is the midpoint formula at t = 0.5", () => {
    const [a, b, c, d] = [p(0, 0), p(0, 100), p(100, 100), p(100, 0)];
    expect(cubicAt(a, b, c, d, 0)).toEqual(a);
    expect(cubicAt(a, b, c, d, 1)).toEqual(d);
    expect(cubicAt(a, b, c, d, 0.5)).toEqual(p(50, 75));
  });
});

describe("cubicLength", () => {
  test("all four points equal gives 0", () => {
    expect(cubicLength(p(5, 5), p(5, 5), p(5, 5), p(5, 5))).toBe(0);
  });

  test("collinear, evenly spaced controls give the chord exactly", () => {
    expect(Math.abs(cubicLength(p(0, 0), p(10, 0), p(20, 0), p(30, 0)) - 30)).toBeLessThan(1e-9);
    const length = cubicLength(p(245, 0), p(245, 200 / 3), p(245, 400 / 3), p(245, 200));
    expect(Math.abs(length - 200)).toBeLessThan(1e-9);
    const diagonal = cubicLength(p(0, 0), p(1, 1), p(2, 2), p(3, 3));
    expect(Math.abs(diagonal - 3 * Math.SQRT2)).toBeLessThan(1e-9);
  });

  test("quarter-circle approximation matches a fine polyline within 1e-6 mm", () => {
    const k = 0.5522847498;
    const curve = [p(100, 0), p(100, 100 * k), p(100 * k, 100), p(0, 100)] as const;
    const reference = polylineLength(...curve, 1_000_000);
    expect(Math.abs(cubicLength(...curve) - reference)).toBeLessThan(1e-6);
  });

  test("an S-curve and a cusp-like curve match a fine polyline within 0.01 mm", () => {
    const sCurve = [p(0, 0), p(100, 0), p(0, 100), p(100, 100)] as const;
    expect(Math.abs(cubicLength(...sCurve) - polylineLength(...sCurve, 1_000_000))).toBeLessThan(
      0.01,
    );
    const cusp = [p(0, 0), p(100, 100), p(0, 100), p(100, 0)] as const;
    expect(Math.abs(cubicLength(...cusp) - polylineLength(...cusp, 1_000_000))).toBeLessThan(0.01);
  });

  test("reversing the control order gives the same length", () => {
    const [a, b, c, d] = [p(0, 0), p(30, 80), p(120, -40), p(150, 20)];
    expect(cubicLength(d, c, b, a)).toBeCloseTo(cubicLength(a, b, c, d), 9);
  });
});
