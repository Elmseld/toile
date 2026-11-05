import { describe, expect, test } from "bun:test";
import { cubicAt, cubicLength, cubicLengthTo, cubicParameterAtLength, cubicTangent } from "./bezier";
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

describe("cubicLengthTo", () => {
  const curve = [p(0, 0), p(30, 80), p(120, -40), p(150, 20)] as const;

  test("at t = 1 is exactly cubicLength, at t = 0 is 0", () => {
    expect(cubicLengthTo(...curve, 1)).toBe(cubicLength(...curve));
    expect(cubicLengthTo(...curve, 0)).toBe(0);
  });

  test("matches a fine polyline up to t", () => {
    const t = 0.37;
    let total = 0;
    let previous = curve[0];
    for (let i = 1; i <= 100_000; i++) {
      const next = cubicAt(...curve, (t * i) / 100_000);
      total += distance(previous, next);
      previous = next;
    }
    expect(Math.abs(cubicLengthTo(...curve, t) - total)).toBeLessThan(0.01);
  });
});

describe("cubicParameterAtLength", () => {
  test("inverts cubicLengthTo within 0.01 mm", () => {
    const k = 0.5522847498;
    for (const curve of [
      [p(0, 0), p(30, 80), p(120, -40), p(150, 20)],
      [p(100, 0), p(100, 100 * k), p(100 * k, 100), p(0, 100)],
      [p(0, 0), p(0, 0), p(50, 0), p(100, 0)],
      [p(0, 0), p(100, 100), p(0, 100), p(100, 0)],
    ] as const) {
      const total = cubicLength(...curve);
      for (const fraction of [0.001, 0.1, 0.25, 0.5, 0.9, 0.999]) {
        const t = cubicParameterAtLength(...curve, total * fraction);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
        expect(Math.abs(cubicLengthTo(...curve, t) - total * fraction)).toBeLessThan(0.01);
      }
    }
  });

  test("clamps lengths outside the curve to its ends", () => {
    const curve = [p(0, 0), p(10, 0), p(20, 0), p(30, 0)] as const;
    expect(cubicParameterAtLength(...curve, -5)).toBe(0);
    expect(cubicParameterAtLength(...curve, 0)).toBe(0);
    expect(cubicParameterAtLength(...curve, 30)).toBe(1);
    expect(cubicParameterAtLength(...curve, 40)).toBe(1);
    expect(cubicParameterAtLength(...curve, Number.NaN)).toBe(0);
  });

  test("evenly spaced straight controls give the length fraction exactly", () => {
    expect(cubicParameterAtLength(p(0, 0), p(10, 0), p(20, 0), p(30, 0), 12)).toBeCloseTo(0.4, 9);
  });
});

describe("cubicTangent", () => {
  test("is the derivative", () => {
    expect(cubicTangent(p(0, 0), p(10, 0), p(20, 10), p(30, 10), 0)).toEqual(p(30, 0));
    expect(cubicTangent(p(0, 0), p(10, 0), p(20, 10), p(30, 10), 1)).toEqual(p(30, 0));
  });

  test("falls back to the chord where the derivative vanishes", () => {
    expect(cubicTangent(p(0, 0), p(0, 0), p(20, 10), p(30, 10), 0)).toEqual(p(30, 10));
    expect(cubicTangent(p(5, 5), p(5, 5), p(5, 5), p(5, 5), 0.5)).toEqual(p(0, 0));
  });
});
