import { describe, expect, test } from "bun:test";
import {
  cleanLoop,
  concaveJoin,
  cubicSegments,
  type Edge,
  edgeTangent,
  findCrossings,
  flattenEdge,
  leftmostIndex,
  MAX_CUBIC_SEGMENTS,
  MITER_LIMIT,
  offsetEdge,
  outerBoundary,
  outwardNormal,
  polygonArea,
  reverseEdge,
} from "./offset";
import { crossesAny, joinCorner, joinStrands, polygonsCross, roundJoin } from "./offset";
import { distance, type Point } from "./vector";

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
const deg = (degrees: number): Point => ({
  x: Math.cos((degrees * Math.PI) / 180),
  y: Math.sin((degrees * Math.PI) / 180),
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

describe("joinCorner (C)", () => {
  const v = p(100, 0);
  const right = p(1, 0);

  test("a right-angle convex corner gets the exact miter", () => {
    expectPoints(joinCorner(v, right, 10, p(0, 1), 10, 1), [p(100, -10), p(110, -10), p(110, 0)]);
    // The same corner on a counter-clockwise outline: travelling left, then down.
    expectPoints(joinCorner(p(0, 0), p(-1, 0), 10, p(0, 1), 10, -1), [
      p(0, -10),
      p(-10, -10),
      p(-10, 0),
    ]);
  });

  test("an obtuse corner (150 degrees inside) gets the miter on the bisector", () => {
    const t2 = deg(30);
    const points = joinCorner(v, right, 10, t2, 10, 1);
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
    const points = joinCorner(v, right, a, deg(160), a, 1);
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
    const points = joinCorner(v, right, 10, deg(179.9), 10, 1);
    expect(points.length).toBe(4);
    for (const point of points.slice(1, 3)) expect(point.x - 100).toBeCloseTo(40, 1);
    expectPoints(joinCorner(v, right, 10, p(-1, 0), 10, 1), [p(100, -10), v, p(100, 10)]);
  });

  test("zero allowance on one side puts the corner on that edge's extension", () => {
    // Right angle: the miter is on the extension of the second edge, at the first allowance.
    expectPoints(joinCorner(v, right, 10, p(0, 1), 0, 1), [p(100, -10), v]);
    // 120 degrees inside: the first edge's offset meets the second edge's line behind the vertex.
    const t2 = deg(60);
    const points = joinCorner(v, right, 10, t2, 0, 1);
    expect(points.length).toBe(3);
    const miter = points[1]!;
    expect(miter.y).toBeCloseTo(-10, 9);
    expect((miter.x - 100) * t2.y - miter.y * t2.x).toBeCloseTo(0, 9);
    expectPoints(joinCorner(v, right, 0, p(0, 1), 0, 1), [v]);
  });

  test("a smooth join: one point for equal allowances, a straight step otherwise", () => {
    expectPoints(joinCorner(v, right, 10, right, 10, 1), [p(100, -10)]);
    const nearly = joinCorner(v, right, 10, deg(0.3), 10, 1);
    for (const point of nearly) expect(distance(point, p(100, -10))).toBeLessThan(0.06);
    expectPoints(joinCorner(v, right, 10, deg(0.3), 15, 1), [
      p(100, -10),
      p(100 + 15 * deg(0.3).y, -15 * deg(0.3).x),
    ]);
  });

  test("a concave corner goes through the vertex", () => {
    expectPoints(joinCorner(v, right, 10, p(0, -1), 15, 1), [p(100, -10), v, p(85, 0)]);
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

describe("joinStrands", () => {
  const v = p(100, 0);

  test("a convex corner of straight edges keeps its miter", () => {
    const joined = joinStrands(
      [p(0, -10), p(100, -10)],
      [p(110, 0), p(110, 100)],
      v,
      p(1, 0),
      10,
      p(0, 1),
      10,
      1,
      [
        [p(0, 0), v],
        [v, p(100, 100)],
      ],
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
      v,
      p(1, 0),
      10,
      p(0, 1),
      10,
      1,
      [[p(0, 0), v], curling],
    );
    const corner = joined.a.slice(2);
    expect(corner.length).toBeGreaterThan(3);
    for (const point of corner) expect(distance(point, v)).toBeCloseTo(10, 9);
  });

  test("safe mode makes a convex corner round and takes no extension at a concave one", () => {
    const round = joinStrands(
      [p(0, -10), p(100, -10)],
      [p(110, 0), p(110, 100)],
      v,
      p(1, 0),
      10,
      p(0, 1),
      10,
      1,
      [],
      true,
    );
    for (const point of round.a.slice(2)) expect(distance(point, v)).toBeCloseTo(10, 9);
    // Zero allowance on the second edge at 60 degrees: only the first strand, extended, meets it.
    const t2 = deg(-60);
    const b = [v, p(100 + 100 * t2.x, 100 * t2.y)];
    const exact = joinStrands([p(0, -10), p(100, -10)], b, v, p(1, 0), 10, t2, 0, 1);
    expectPoint(exact.a[exact.a.length - 1], 100 + 10 / Math.tan(Math.PI / 3), -10);
    const safe = joinStrands([p(0, -10), p(100, -10)], b, v, p(1, 0), 10, t2, 0, 1, [], true);
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
    const joined = joinStrands([p(0, -10), q1], [q2, p(0, 12)], v, t1, 10, t2, 10, 1, guard);
    const tip = Math.max(...joined.a.map((point) => point.x));
    expect(tip).toBeGreaterThan(130);
    // In safe mode the tip is round, around the outside of the spike.
    const round = joinStrands([p(0, -10), q1], [q2, p(0, 12)], v, t1, 10, t2, 10, 1, guard, true);
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
    const concave = joinStrands([p(0, -10), r1], [r2, p(0, 10)], v, s1, 10, s2, 10, 1, slit);
    expect(Math.max(...concave.a.map((point) => point.x))).toBeLessThan(100.5);
    expect(concave.a).toContainEqual(v);
  });
});

describe("roundJoin, crossesAny and polygonsCross", () => {
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
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    expect(polygonsCross(square, [p(5, 5), p(15, 5), p(15, 6)])).toBe(true);
    expect(polygonsCross(square, [p(2, 2), p(8, 2), p(8, 8)])).toBe(false);
    expect(polygonsCross(square, square)).toBe(false);
  });
});
