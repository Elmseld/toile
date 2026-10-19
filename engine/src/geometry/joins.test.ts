import { describe, expect, test } from "bun:test";
import {
  concaveJoin,
  type Corner,
  crossesAny,
  joinCorner,
  joinStrands,
  MITER_LIMIT,
  roundJoin,
} from "./joins";
import { distance, type Point, pointSegmentDistance } from "./vector";

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

const deg = (degrees: number): Point => ({
  x: Math.cos((degrees * Math.PI) / 180),
  y: Math.sin((degrees * Math.PI) / 180),
});

const corner = (vertex: Point, t1: Point, a1: number, t2: Point, a2: number, sign = 1): Corner => ({
  vertex,
  t1,
  a1,
  t2,
  a2,
  sign,
});

// The points of `joinCorner` at the corner given by its parts.
const cornerPoints = (vertex: Point, t1: Point, a1: number, t2: Point, a2: number, sign: number) =>
  joinCorner(corner(vertex, t1, a1, t2, a2, sign)).points;

describe("joinCorner (C)", () => {
  const v = p(100, 0);
  const right = p(1, 0);

  test("a right-angle convex corner gets the exact miter", () => {
    expectPoints(cornerPoints(v, right, 10, p(0, 1), 10, 1), [p(100, -10), p(110, -10), p(110, 0)]);
    // The same corner on a counter-clockwise outline: travelling left, then down.
    expectPoints(cornerPoints(p(0, 0), p(-1, 0), 10, p(0, 1), 10, -1), [
      p(0, -10),
      p(-10, -10),
      p(-10, 0),
    ]);
  });

  test("an obtuse corner (150 degrees inside) gets the miter on the bisector", () => {
    const t2 = deg(30);
    const points = cornerPoints(v, right, 10, t2, 10, 1);
    expect(points.length).toBe(3);
    const reach = 10 / Math.cos((15 * Math.PI) / 180);
    expectPoint(
      points[1],
      100 + reach * Math.sin((15 * Math.PI) / 180),
      -reach * Math.cos((15 * Math.PI) / 180),
    );
  });

  test("an acute corner (20 degrees inside) is cut off at MITER_LIMIT times the allowance", () => {
    const a = 10;
    const limit = MITER_LIMIT * a;
    const s80 = Math.sin((80 * Math.PI) / 180);
    const c80 = Math.cos((80 * Math.PI) / 180);
    const along = (limit - a * c80) / s80;
    const points = cornerPoints(v, right, a, deg(160), a, 1);
    const t2 = deg(160);
    const q2 = p(100 + a * t2.y, -a * t2.x);
    expectPoints(points, [
      p(100, -10),
      p(100 + along, -10),
      p(q2.x - along * t2.x, q2.y - along * t2.y),
      q2,
    ]);
    const bisector = deg(-10);
    for (const point of points.slice(1, 3)) {
      expect((point.x - 100) * bisector.x + point.y * bisector.y).toBeCloseTo(limit, 9);
    }
  });

  test("a near hairpin is cut off square at the limit, and an exact hairpin counts as concave", () => {
    const points = cornerPoints(v, right, 10, deg(179.9), 10, 1);
    expect(points.length).toBe(4);
    for (const point of points.slice(1, 3)) expect(point.x - 100).toBeCloseTo(40, 1);
    expectPoints(cornerPoints(v, right, 10, p(-1, 0), 10, 1), [p(100, -10), v, p(100, 10)]);
  });

  test("zero allowance on one side puts the corner on that edge's extension", () => {
    // Right angle: the miter is on the extension of the second edge, at the first allowance.
    expectPoints(cornerPoints(v, right, 10, p(0, 1), 0, 1), [p(100, -10), v]);
    // 120 degrees inside: the first edge's offset meets the second edge's line behind the vertex.
    const t2 = deg(60);
    const points = cornerPoints(v, right, 10, t2, 0, 1);
    expect(points.length).toBe(3);
    const miter = points[1]!;
    expect(miter.y).toBeCloseTo(-10, 9);
    expect((miter.x - 100) * t2.y - miter.y * t2.x).toBeCloseTo(0, 9);
    expectPoints(cornerPoints(v, right, 0, p(0, 1), 0, 1), [v]);
  });

  test("a smooth join: one point for equal allowances, a straight step otherwise", () => {
    expectPoints(cornerPoints(v, right, 10, right, 10, 1), [p(100, -10)]);
    const nearly = cornerPoints(v, right, 10, deg(0.3), 10, 1);
    for (const point of nearly) expect(distance(point, p(100, -10))).toBeLessThan(0.06);
    expectPoints(cornerPoints(v, right, 10, deg(0.3), 15, 1), [
      p(100, -10),
      p(100 + 15 * deg(0.3).y, -15 * deg(0.3).x),
    ]);
  });

  describe("a 40 mm hem meeting a 10 mm side seam", () => {
    // Every point of the corner's polyline, sampled every 0.1 mm, keeps the smaller allowance from
    // the two edges at the vertex (straight, 1 m long).
    function minimumClearance(points: readonly Point[], t1: Point, t2: Point): number {
      const before = p(v.x - 1000 * t1.x, v.y - 1000 * t1.y);
      const after = p(v.x + 1000 * t2.x, v.y + 1000 * t2.y);
      let least = Infinity;
      for (let i = 0; i + 1 < points.length; i++) {
        const from = points[i]!;
        const to = points[i + 1]!;
        const steps = Math.max(1, Math.ceil(distance(from, to) / 0.1));
        for (let k = 0; k <= steps; k++) {
          const at = p(
            from.x + ((to.x - from.x) * k) / steps,
            from.y + ((to.y - from.y) * k) / steps,
          );
          least = Math.min(
            least,
            pointSegmentDistance(at, before, v),
            pointSegmentDistance(at, v, after),
          );
        }
      }
      return least;
    }

    // The two offset tangent lines' intersection, its distance from the vertex: under the limit
    // for a miter, over it for a step.
    function miterReach(turn: number, a1: number, a2: number): number {
      const s = Math.sin((turn * Math.PI) / 180);
      const c = Math.cos((turn * Math.PI) / 180);
      return Math.hypot(a1, (a2 - a1 * c) / s);
    }

    for (const [a1, a2] of [
      [40, 10],
      [10, 40],
    ] as const) {
      for (const turn of [30, 60, 85]) {
        test(`${a1} then ${a2} at a ${turn} degree turn: a miter, at least 10 mm out`, () => {
          expect(miterReach(turn, a1, a2)).toBeLessThanOrEqual(MITER_LIMIT * 40);
          const points = cornerPoints(v, right, a1, deg(turn), a2, 1);
          expect(points.length).toBe(3);
          expect(minimumClearance(points, right, deg(turn))).toBeGreaterThanOrEqual(10 - 1e-9);
        });
      }

      // Below about 11 degrees the miter lies beyond the limit, on the 40 mm line behind the
      // end of the hem (or ahead of the start): squaring it off on the bisector would reach far
      // along the edges, so the corner is the straight step between the two offset ends.
      for (const turn of [2, 5, 10]) {
        test(`${a1} then ${a2} at a ${turn} degree turn: a straight step, at least 10 mm out`, () => {
          expect(miterReach(turn, a1, a2)).toBeGreaterThan(MITER_LIMIT * 40);
          const t2 = deg(turn);
          const points = cornerPoints(v, right, a1, t2, a2, 1);
          expectPoints(points, [p(100, -a1), p(100 + a2 * t2.y, -a2 * t2.x)]);
          expect(minimumClearance(points, right, t2)).toBeCloseTo(10, 9);
        });
      }
    }
  });

  test("a concave corner goes through the vertex", () => {
    expectPoints(cornerPoints(v, right, 10, p(0, -1), 15, 1), [p(100, -10), v, p(85, 0)]);
    expect(joinCorner(corner(v, right, 10, p(0, -1), 15)).concave).toBe(true);
    expect(joinCorner(corner(v, right, 10, p(0, 1), 15)).concave).toBe(false);
    // The caller's verdict wins over the tangents'.
    expect(joinCorner(corner(v, right, 10, p(0, 1), 15), false).concave).toBe(true);
  });
});

describe("concaveJoin", () => {
  test("trims both strands at their intersection", () => {
    // Offsets of a concave right angle: along y = -10 to x = 100, then up along x = 85.
    const a = [p(0, -10), p(100, -10)];
    const b = [p(85, 0), p(85, -100)];
    const join = concaveJoin(a, b, p(1, 0), p(0, -1), p(100, 0), 60);
    expect(join).toEqual({ point: p(85, -10), keepA: 1, keepB: 1 });
  });

  test("extends a strand that stops short of the other one", () => {
    // Zero allowance on the second edge, at 60 degrees: the first offset runs on to meet it.
    const t2 = deg(-60);
    const b = [p(100, 0), p(100 + 100 * t2.x, 100 * t2.y)];
    const join = concaveJoin([p(0, -10), p(100, -10)], b, p(1, 0), t2, p(100, 0), 40);
    expect(
      concaveJoin([p(0, -10), p(100, -10)], b, p(1, 0), t2, p(100, 0), 40, { maxRank: 0 }),
    ).toBeNull();
    expect(join?.keepA).toBe(2);
    expect(join?.keepB).toBe(1);
    expectPoint(join?.point, 100 + 10 / Math.tan(Math.PI / 3), -10);
  });

  test("extends the second strand back to the first one", () => {
    const join = concaveJoin(
      [p(0, 0), p(100, 0)],
      [p(110, -20), p(110, -100)],
      p(1, 0),
      p(0, -1),
      p(100, 0),
      40,
    );
    expect(join).toEqual({ point: p(110, 0), keepA: 2, keepB: 0 });
  });

  test("coinciding ends join where they are; no intersection within the limit gives null", () => {
    expect(
      concaveJoin([p(0, 0), p(5, 5)], [p(5, 5), p(9, 0)], p(1, 1), p(1, -1), p(5, 6), 10),
    ).toEqual({
      point: p(5, 5),
      keepA: 2,
      keepB: 0,
    });
    expect(
      concaveJoin(
        [p(0, -10), p(100, -10)],
        [p(85, 0), p(85, -100)],
        p(1, 0),
        p(0, -1),
        p(100, 0),
        5,
      ),
    ).toBeNull();
    expect(concaveJoin([], [p(0, 0)], p(1, 0), p(0, 1), p(0, 0), 5)).toBeNull();
  });
});

describe("joinStrands", () => {
  const v = p(100, 0);

  test("a convex corner of straight edges keeps its miter", () => {
    const joined = joinStrands(
      [p(0, -10), p(100, -10)],
      [p(110, 0), p(110, 100)],
      corner(v, p(1, 0), 10, p(0, 1), 10),
      {
        guard: [
          [p(0, 0), v],
          [v, p(100, 100)],
        ],
      },
    );
    expect(joined.a).toEqual([p(0, -10), p(100, -10), p(100, -10), p(110, -10), p(110, 0)]);
    expect(joined.b).toEqual([p(110, 0), p(110, 100)]);
  });

  test("a miter that would come too close to a curling edge becomes round", () => {
    // The second edge leaves straight down but curls up at once, close under the miter's leg.
    const curling = [v, p(100, 1), p(103, 1), p(106, -1), p(107, -4)];
    const joined = joinStrands(
      [p(0, -10), p(100, -10)],
      [p(110, 0)],
      corner(v, p(1, 0), 10, p(0, 1), 10),
      { guard: [[p(0, 0), v], curling] },
    );
    const round = joined.a.slice(2);
    expect(round.length).toBeGreaterThan(3);
    for (const point of round) expect(distance(point, v)).toBeCloseTo(10, 9);
  });

  test("safe mode makes a convex corner round and takes no extension at a concave one", () => {
    const round = joinStrands(
      [p(0, -10), p(100, -10)],
      [p(110, 0), p(110, 100)],
      corner(v, p(1, 0), 10, p(0, 1), 10),
      { safe: true },
    );
    for (const point of round.a.slice(2)) expect(distance(point, v)).toBeCloseTo(10, 9);
    // Zero allowance on the second edge at 60 degrees: only the first strand, extended, meets it.
    const t2 = deg(-60);
    const b = [v, p(100 + 100 * t2.x, 100 * t2.y)];
    const exact = joinStrands([p(0, -10), p(100, -10)], b, corner(v, p(1, 0), 10, t2, 0));
    expectPoint(exact.a[exact.a.length - 1], 100 + 10 / Math.tan(Math.PI / 3), -10);
    const safe = joinStrands([p(0, -10), p(100, -10)], b, corner(v, p(1, 0), 10, t2, 0), {
      safe: true,
    });
    expect(safe.a.slice(-2)).toEqual([p(100, -10), v]);
  });

  test("near a hairpin the flattened edges decide: a spike gets a cut-off miter, or a round tip", () => {
    // Both tangents point almost straight back, the tangents alone call it concave, but the
    // edges spread apart: a spike pointing right.
    const t1 = deg(-1);
    const t2 = deg(182);
    const guard = [
      [p(0, 0), p(90, 0), v],
      [v, p(90, 0.05), p(0, 2)],
    ];
    const q1 = p(100 + 10 * t1.y, -10 * t1.x);
    const q2 = p(100 + 10 * t2.y, -10 * t2.x);
    const joined = joinStrands([p(0, -10), q1], [q2, p(0, 12)], corner(v, t1, 10, t2, 10), { guard });
    const tip = Math.max(...joined.a.map((point) => point.x));
    expect(tip).toBeGreaterThan(130);
    // In safe mode the tip is round, around the outside of the spike.
    const round = joinStrands([p(0, -10), q1], [q2, p(0, 12)], corner(v, t1, 10, t2, 10), {
      guard,
      safe: true,
    });
    expect(Math.max(...round.a.map((point) => point.x))).toBeCloseTo(110, 1);
    // A slit: tangents that again call it convex, edges that close in. It is concave, so the
    // line goes through the tip instead of past it.
    const s1 = deg(1);
    const s2 = deg(178);
    const slit = [
      [p(0, 2), p(90, 0.05), v],
      [v, p(90, 0), p(0, 0)],
    ];
    const r1 = p(100 + 10 * s1.y, -10 * s1.x);
    const r2 = p(100 + 10 * s2.y, -10 * s2.x);
    const concave = joinStrands([p(0, -10), r1], [r2, p(0, 10)], corner(v, s1, 10, s2, 10), {
      guard: slit,
    });
    expect(Math.max(...concave.a.map((point) => point.x))).toBeLessThan(100.5);
    expect(concave.a).toContainEqual(v);
  });
});

describe("roundJoin and crossesAny", () => {
  test("a round join runs the short way, its radius blending the allowances", () => {
    const points = roundJoin(p(0, 0), p(0, -1), 10, p(1, 0), 20);
    expectPoint(points[0], 0, -10);
    expectPoint(points[points.length - 1], 20, 0);
    for (const point of points) expect(point.x).toBeGreaterThanOrEqual(-1e-9);
    expect(roundJoin(p(0, 0), p(0, -1), 0, p(0, -1), 0)).toEqual([p(0, 0)]);
    // Opposite normals: the arc passes through the given direction, either way round.
    for (const through of [p(1, 0), p(-1, 0)]) {
      const arc = roundJoin(p(0, 0), p(0, -1), 10, p(0, 1), 10, through);
      expect(arc.some((point) => distance(point, p(10 * through.x, 0)) < 0.1)).toBe(true);
    }
  });

  test("crossings count only when clear of rounding", () => {
    expect(crossesAny([p(0, 0), p(10, 10)], [[p(0, 10), p(10, 0)]])).toBe(true);
    expect(crossesAny([p(0, 0), p(10, 0)], [[p(5, 0), p(5, 10)]])).toBe(false);
    expect(crossesAny([p(0, 0), p(10, 0)], [[p(5, -1e-12), p(15, 1e-12)]])).toBe(false);
  });
});
