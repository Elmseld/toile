import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cubicAt, cubicDerivative } from "./bezier";
import { findDarts } from "./darts";
import { evaluatePattern } from "./evaluate";
import { insidePolygon } from "./label";
import { findCrossings } from "./boundary";
import { MITER_LIMIT } from "./joins";
import { cubicSegments, type Edge, MAX_CUTTING_LINE_SEGMENTS, polygonArea } from "./offset";
import {
  type CuttingPiece,
  cuttingLine,
  MAX_ALLOWANCE_ERRORS,
  MAX_RAW_LINE_POINTS,
  MAX_SEAM_ALLOWANCE,
  type SeamAllowances,
} from "./seam-allowance";
import { MAX_OUTLINE_ENTRIES, MAX_SECTION_ENTRIES } from "./validate";
import { cross, distance, MAX_COORDINATE, type Point } from "./vector";

const BLOCKS_DIR = join(import.meta.dir, "..", "..", "blocks");
const EXAMPLE_PATH = join(import.meta.dir, "..", "..", "examples", "rectangle-with-dart.json");
/** Tolerance (mm) of the sampled distance checks. */
const TOLERANCE = 0.05;

// prettier-ignore
const PROFILES: Record<string, Record<string, number>> = {
  small: {
    bust: 820, waist: 640, hip: 880, neck: 350, shoulder_width: 118, back_width: 330,
    chest_width: 310, back_length: 400, armhole_depth: 200, front_length: 430, bust_height: 255,
    bust_distance: 180, hip_height: 200, skirt_length: 550,
  },
  medium: {
    bust: 880, waist: 680, hip: 940, neck: 370, shoulder_width: 122, back_width: 344,
    chest_width: 324, back_length: 410, armhole_depth: 210, front_length: 445, bust_height: 265,
    bust_distance: 190, hip_height: 206, skirt_length: 600,
  },
  large: {
    bust: 1080, waist: 900, hip: 1140, neck: 410, shoulder_width: 130, back_width: 390,
    chest_width: 370, back_length: 430, armhole_depth: 235, front_length: 490, bust_height: 300,
    bust_distance: 220, hip_height: 220, skirt_length: 700,
  },
};

const p = (x: number, y: number): Point => ({ x, y });

// Deterministic pseudo-random generator (mulberry32) so the fuzz tests never flake.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A piece of straight edges through `points`, named e0, e1, ... */
function polygonPiece(points: Point[]): { outline: Edge[] } {
  return {
    outline: points.map((from, i) => ({
      name: `e${i}`,
      type: "line",
      from,
      to: points[(i + 1) % points.length]!,
    })),
  };
}

function reversePiece(piece: { outline: readonly Edge[] }): { outline: Edge[] } {
  return {
    outline: [...piece.outline]
      .reverse()
      .map((edge) =>
        edge.type === "line"
          ? { ...edge, from: edge.to, to: edge.from }
          : { ...edge, from: edge.to, c1: edge.c2, c2: edge.c1, to: edge.from },
      ),
  };
}

function points(result: ReturnType<typeof cuttingLine>): Point[] {
  if (!result.ok) throw new Error(`no cutting line: ${JSON.stringify(result.errors)}`);
  return result.points;
}

function expectPoints(actual: readonly Point[], expected: readonly Point[]): void {
  expect(actual.length).toBe(expected.length);
  expected.forEach((point, i) => {
    expect(actual[i]!.x).toBeCloseTo(point.x, 9);
    expect(actual[i]!.y).toBeCloseTo(point.y, 9);
  });
}

type Sample = { point: Point; edge: number; t: number };

/** A fine flattening of the outline: `cubicSteps` per cubic, about 1 mm steps along lines. */
function reference(outline: readonly Edge[], cubicSteps = 1024): Sample[] {
  const samples: Sample[] = [];
  outline.forEach((edge, index) => {
    const steps =
      edge.type === "cubic" ? cubicSteps : Math.max(1, Math.ceil(distance(edge.from, edge.to)));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const point =
        edge.type === "cubic"
          ? cubicAt(edge.from, edge.c1, edge.c2, edge.to, t)
          : p(
              edge.from.x + (edge.to.x - edge.from.x) * t,
              edge.from.y + (edge.to.y - edge.from.y) * t,
            );
      samples.push({ point, edge: index, t });
    }
  });
  return samples;
}

function pointSegment(point: Point, a: Point, b: Point): { distance: number; s: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const s =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return { distance: Math.hypot(point.x - a.x - s * dx, point.y - a.y - s * dy), s };
}

/** The nearest point of the (finely flattened, closed) outline to `point`. */
function nearest(
  samples: readonly Sample[],
  point: Point,
): { distance: number; at: Point; edge: number; t: number } {
  let best = { distance: Infinity, at: point, edge: -1, t: 0 };
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]!;
    const b = samples[(i + 1) % samples.length]!;
    const hit = pointSegment(point, a.point, b.point);
    if (hit.distance < best.distance) {
      const end = b.edge === a.edge ? b.t : 1;
      best = {
        distance: hit.distance,
        at: p(
          a.point.x + (b.point.x - a.point.x) * hit.s,
          a.point.y + (b.point.y - a.point.y) * hit.s,
        ),
        edge: a.edge,
        t: a.t + (end - a.t) * hit.s,
      };
    }
  }
  return best;
}

function polygonDistance(polygon: readonly Point[], point: Point): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    best = Math.min(
      best,
      pointSegment(point, polygon[i]!, polygon[(i + 1) % polygon.length]!).distance,
    );
  }
  return best;
}

/** Whether any two non-adjacent segments of the closed polygon meet (touching included). */
function selfIntersects(polygon: readonly Point[]): boolean {
  const n = polygon.length;
  const orient = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = polygon[j]!;
      const d = polygon[(j + 1) % n]!;
      if (Math.max(c.x, d.x) < Math.min(a.x, b.x) || Math.max(a.x, b.x) < Math.min(c.x, d.x))
        continue;
      if (Math.max(c.y, d.y) < Math.min(a.y, b.y) || Math.max(a.y, b.y) < Math.min(c.y, d.y))
        continue;
      const d1 = orient(c, d, a);
      const d2 = orient(c, d, b);
      const d3 = orient(a, b, c);
      const d4 = orient(a, b, d);
      if (d1 * d2 <= 0 && d3 * d4 <= 0) return true;
    }
  }
  return false;
}

/** Signed turning (degrees) at each inner point of an open run of points. */
function turns(run: readonly Point[]): number[] {
  const result: number[] = [];
  for (let i = 1; i + 1 < run.length; i++) {
    const u = p(run[i]!.x - run[i - 1]!.x, run[i]!.y - run[i - 1]!.y);
    const v = p(run[i + 1]!.x - run[i]!.x, run[i + 1]!.y - run[i]!.y);
    result.push((Math.atan2(cross(u, v), u.x * v.x + u.y * v.y) * 180) / Math.PI);
  }
  return result;
}

/** The smallest radius of curvature of a cubic edge, sampled. */
function minRadius(edge: Extract<Edge, { type: "cubic" }>): number {
  let smallest = Infinity;
  for (let k = 0; k <= 400; k++) {
    const t = k / 400;
    const d1 = cubicDerivative(edge.from, edge.c1, edge.c2, edge.to, t);
    const u = 1 - t;
    // B''(t) = 6 [(1-t)(p2 - 2 p1 + p0) + t (p3 - 2 p2 + p1)]
    const d2 = p(
      6 *
        (u * (edge.c2.x - 2 * edge.c1.x + edge.from.x) +
          t * (edge.to.x - 2 * edge.c2.x + edge.c1.x)),
      6 *
        (u * (edge.c2.y - 2 * edge.c1.y + edge.from.y) +
          t * (edge.to.y - 2 * edge.c2.y + edge.c1.y)),
    );
    const speed = Math.hypot(d1.x, d1.y);
    smallest = Math.min(smallest, speed ** 3 / Math.abs(cross(d1, d2)));
  }
  return smallest;
}

/**
 * How far from the outline the cutting line can reach: a miter cut off square at MITER_LIMIT
 * times the allowance from the corner, plus at most one allowance sideways along the cut.
 */
function reach(allowance: number): number {
  return Math.hypot(MITER_LIMIT * allowance, allowance) + TOLERANCE;
}

function allowanceOf(allowances: SeamAllowances, name: string): number {
  return allowances.edges?.[name] ?? allowances.default;
}

type CheckOptions = {
  /** Outline points within this distance of these points are not checked for distance. */
  excluded?: { at: Point; radius: number }[];
  /** Edge indices (dart legs) whose nearby cutting-line points are not checked for distance. */
  skipEdges?: Set<number>;
};

/**
 * The properties every cutting line has: simple, same orientation, outline inside or on it, and
 * every point at the allowance of the edge it is nearest to (away from that edge's ends), never
 * closer to the outline than that allowance less the tolerance (at most MITER_LIMIT times it).
 * Returns the reference samples and the nearest outline point of each cutting-line point.
 */
function checkProperties(
  piece: { outline: readonly Edge[] },
  allowances: SeamAllowances,
  line: readonly Point[],
  options: CheckOptions = {},
): { samples: Sample[]; near: ReturnType<typeof nearest>[] } {
  const { outline } = piece;
  const samples = reference(outline);
  const areaSign = Math.sign(polygonArea(samples.map((sample) => sample.point)));
  expect(Math.sign(polygonArea(line))).toBe(areaSign);
  expect(selfIntersects(line)).toBe(false);
  for (const sample of samples) {
    const { x, y } = sample.point;
    if (!insidePolygon(line, x, y))
      expect(polygonDistance(line, sample.point)).toBeLessThan(TOLERANCE);
  }
  const all = outline.map((edge) => allowanceOf(allowances, edge.name));
  const largest = Math.max(...all);
  const smallest = Math.min(...all);
  const near = line.map((point) => nearest(samples, point));
  near.forEach((found) => {
    expect(found.distance).toBeGreaterThanOrEqual(smallest - TOLERANCE);
    expect(found.distance).toBeLessThanOrEqual(reach(largest));
    if (options.skipEdges?.has(found.edge)) return;
    if (options.excluded?.some((zone) => distance(zone.at, found.at) < zone.radius)) return;
    const edge = outline[found.edge]!;
    const a = all[found.edge]!;
    const clear = Math.max(largest, TOLERANCE);
    if (distance(found.at, edge.from) > clear && distance(found.at, edge.to) > clear) {
      expect(Math.abs(found.distance - a)).toBeLessThan(TOLERANCE);
    }
  });
  return { samples, near };
}

describe("a rectangle (I)", () => {
  const corners = [p(0, 0), p(200, 0), p(200, 100), p(0, 100)];

  test("allowance 10 gives the 220 x 120 rectangle, in either outline direction", () => {
    const clockwise = polygonPiece(corners);
    expectPoints(points(cuttingLine(clockwise, { default: 10 })), [
      p(-10, -10),
      p(210, -10),
      p(210, 110),
      p(-10, 110),
    ]);
    expectPoints(points(cuttingLine(reversePiece(clockwise), { default: 10 })), [
      p(-10, -10),
      p(-10, 110),
      p(210, 110),
      p(210, -10),
    ]);
  });

  test("mixed allowances with a fold edge: exact corners, the fold on the line", () => {
    const piece = polygonPiece(corners);
    // e0 top, e1 right side, e2 hem, e3 left side (the fold).
    const allowances = { default: 10, edges: { e1: 15, e2: 40, e3: 0 } };
    const line = points(cuttingLine(piece, allowances));
    expectPoints(line, [p(0, -10), p(215, -10), p(215, 140), p(0, 140)]);
    for (let y = 0; y <= 100; y += 5) expect(polygonDistance(line, p(0, y))).toBeLessThan(1e-9);
    checkProperties(piece, allowances, line);
  });

  test("allowance 0 everywhere is the outline itself", () => {
    expectPoints(points(cuttingLine(polygonPiece(corners), { default: 0 })), corners);
  });
});

describe("pieces with a curved edge (J)", () => {
  // A 200 x 100 rectangle whose right side is a cubic.
  function curvedPiece(c1: Point, c2: Point): { outline: Edge[] } {
    return {
      outline: [
        { name: "top", type: "line", from: p(0, 0), to: p(200, 0) },
        { name: "side", type: "cubic", from: p(200, 0), c1, c2, to: p(200, 100) },
        { name: "hem", type: "line", from: p(200, 100), to: p(0, 100) },
        { name: "fold", type: "line", from: p(0, 100), to: p(0, 0) },
      ],
    };
  }

  const shapes: [string, Point, Point][] = [
    ["a convex bulge", p(260, 20), p(260, 80)],
    ["a concave hollow", p(160, 20), p(160, 80)],
    ["a tight concave bump", p(120, 49), p(120, 51)],
    ["an S-curve", p(240, 30), p(160, 70)],
  ];
  for (const [label, c1, c2] of shapes) {
    for (const allowances of [
      { default: 10 },
      { default: 25 },
      { default: 15, edges: { fold: 0, hem: 40 } },
    ]) {
      test(`${label} at ${JSON.stringify(allowances)}`, () => {
        const piece = curvedPiece(c1, c2);
        const line = points(cuttingLine(piece, allowances));
        checkProperties(piece, allowances, line);
        checkProperties(
          reversePiece(piece),
          allowances,
          points(cuttingLine(reversePiece(piece), allowances)),
        );
      });
    }
  }

  test("the tight bump really is tighter than the allowance (the case is not vacuous)", () => {
    const side = curvedPiece(p(120, 49), p(120, 51)).outline[1] as Extract<Edge, { type: "cubic" }>;
    expect(minRadius(side)).toBeLessThan(15);
  });
});

describe("the conservative construction", () => {
  // A wide allowance on a short line between two curves that curl away from it: the miters and
  // extensions of the first construction cut across the piece there.
  const piece: CuttingPiece = {
    outline: [
      { name: "e20", type: "line", from: p(508.2, 162.1), to: p(510.6, 359.7) },
      {
        name: "e1",
        type: "cubic",
        from: p(510.6, 359.7),
        c1: p(501.4, 386.1),
        c2: p(484.6, 401.9),
        to: p(454.8, 399.4),
      },
      { name: "e2", type: "line", from: p(454.8, 399.4), to: p(434.0, 452.3) },
      {
        name: "e3",
        type: "cubic",
        from: p(434.0, 452.3),
        c1: p(422.9, 469.0),
        c2: p(398.0, 461.3),
        to: p(387.3, 478.8),
      },
      { name: "e4", type: "line", from: p(387.3, 478.8), to: p(508.2, 162.1) },
    ],
  };
  const allowances = { default: 8, edges: { e2: 28 } };

  test("is reported, and still gives a simple line around the piece", () => {
    const result = cuttingLine(piece, allowances);
    expect(result.ok && result.approximations).toEqual([{ kind: "safe_construction" }]);
    const line = points(result);
    expect(selfIntersects(line)).toBe(false);
    for (const edge of piece.outline) {
      const inside = insidePolygon(line, edge.from.x, edge.from.y);
      expect(inside || polygonDistance(line, edge.from) < TOLERANCE).toBe(true);
    }
  });
});

describe("darts through cuttingLine (K)", () => {
  const W = 10;
  const H = 100;
  const a = 10;

  test("the rectangle with a dart gets its peak, not its legs", () => {
    const piece = polygonPiece([
      p(-200, 0),
      p(-W, 0),
      p(0, H),
      p(W, 0),
      p(200, 0),
      p(200, 300),
      p(-200, 300),
    ]);
    const line = points(cuttingLine(piece, { default: a }));
    const theta = 2 * Math.atan(W / H);
    for (const peak of [
      p((-W * (H + a)) / H, -a),
      p(0, H - (H + a) / Math.cos(theta)),
      p((W * (H + a)) / H, -a),
    ]) {
      expect(line.some((point) => distance(point, peak) < 1e-9)).toBe(true);
    }
    expect(selfIntersects(line)).toBe(false);
    // The legs are inside, well clear of the line.
    for (const t of [0.25, 0.5, 0.75]) {
      expect(polygonDistance(line, p(-W * (1 - t), H * t))).toBeGreaterThan(a);
      expect(polygonDistance(line, p(W * (1 - t), H * t))).toBeGreaterThan(a);
    }
  });

  // Two darts of half-width 10 and depth 90 in the top edge, `between` mm apart: the seam
  // between them is the seam after the first dart and the seam before the second.
  function twoDarts(between: number): Point[] {
    const x1 = -between / 2 - 20;
    const y2 = between / 2 + 20;
    return [
      p(-200, 0),
      p(x1, 0),
      p(x1 + 10, 90),
      p(-between / 2, 0),
      p(between / 2, 0),
      p(y2 - 10, 90),
      p(y2, 0),
      p(200, 0),
      p(200, 300),
      p(-200, 300),
    ];
  }

  for (const [between, allowances] of [
    [40, [5, 10, 15, 25]],
    [4, [5, 10, 15]],
  ] as const) {
    test(`two darts ${between} mm apart both get their peak`, () => {
      const corners = twoDarts(between);
      for (const allowance of allowances) {
        for (const piece of [polygonPiece(corners), reversePiece(polygonPiece(corners))]) {
          const line = points(cuttingLine(piece, { default: allowance }));
          expect(selfIntersects(line)).toBe(false);
          // Each peak is on its dart's centre line, beyond the waist's cutting line.
          for (const centre of [-between / 2 - 10, between / 2 + 10]) {
            const peak = Math.min(
              ...line.filter((point) => Math.abs(point.x - centre) < 1e-9).map((point) => point.y),
            );
            expect(peak).toBeLessThan(-allowance - 1);
          }
          // Nowhere does the line come closer to the outline than the allowance (the old notch
          // at the second dart came within a millimetre of the waist).
          for (const corner of corners) {
            expect(polygonDistance(line, corner)).toBeGreaterThan(allowance - TOLERANCE);
          }
        }
      }
    });
  }

  test("two darts too close for both peaks keep the allowance; the second is a plain notch", () => {
    const corners = twoDarts(0.5);
    for (const allowance of [10, 25]) {
      const result = cuttingLine(polygonPiece(corners), { default: allowance });
      const line = points(result);
      expect(selfIntersects(line)).toBe(false);
      for (const corner of corners) {
        expect(polygonDistance(line, corner)).toBeGreaterThan(allowance - TOLERANCE);
      }
      expect(result.ok && result.approximations).toEqual([
        { kind: "dart_without_peak", legs: [4, 5] },
      ]);
    }
    // The legs are indices into the piece's outline, point-like entries included.
    const piece = polygonPiece(corners);
    const dotted = {
      outline: [
        { name: "dot", type: "line", from: corners[0]!, to: corners[0]! },
        ...piece.outline,
      ] as Edge[],
    };
    const result = cuttingLine(dotted, { default: 10 });
    expect(result.ok && result.approximations).toEqual([
      { kind: "dart_without_peak", legs: [5, 6] },
    ]);
  });

  test("a line built as described has no approximations", () => {
    const result = cuttingLine(polygonPiece(twoDarts(40)), { default: 10 });
    expect(result.ok).toBe(true);
    expect("approximations" in result).toBe(false);
  });

  test("dart leg allowances are validated but not used", () => {
    const piece = polygonPiece([
      p(-200, 0),
      p(-W, 0),
      p(0, H),
      p(W, 0),
      p(200, 0),
      p(200, 300),
      p(-200, 300),
    ]);
    const plain = points(cuttingLine(piece, { default: a }));
    expect(points(cuttingLine(piece, { default: a, edges: { e1: 50, e2: 0 } }))).toEqual(plain);
    const bad = cuttingLine(piece, { default: a, edges: { e1: -1 } });
    expect(bad.ok).toBe(false);
  });

  for (const measurements of [
    { waist: 680, hip: 940, hip_height: 200 },
    { waist: 800, hip: 1080, hip_height: 210 },
  ]) {
    test(`the example definition at waist ${measurements.waist}`, () => {
      const result = evaluatePattern(JSON.parse(readFileSync(EXAMPLE_PATH, "utf8")), {
        measurements,
      });
      const piece = result.pieces.front!;
      const outline = piece.outline as readonly Edge[];
      const allowances = { default: 15, edges: { hem: 30, center: 0 } };
      const line = points(cuttingLine(piece, allowances));
      const [dart] = findDarts(outline, Math.sign(polygonArea(outline.map((edge) => edge.from))));
      expect(dart).toBeDefined();
      const { x, apex, y } = dart!;
      checkProperties(piece, allowances, line, {
        skipEdges: new Set([dart!.legIndex, dart!.legIndex + 1]),
        excluded: [
          { at: x, radius: 30 },
          { at: y, radius: 30 },
        ],
      });
      // The peak lies on the dart's centre line, beyond the waist's cutting line.
      const mid = p((x.x + y.x) / 2, (x.y + y.y) / 2);
      const peak = line.find(
        (point) =>
          Math.abs(
            cross(p(mid.x - apex.x, mid.y - apex.y), p(point.x - apex.x, point.y - apex.y)),
          ) < 1e-6 && point.y < 0,
      );
      expect(peak).toBeDefined();
      expect(peak!.y).toBeLessThan(-15);
      expect(polygonDistance(line, mid)).toBeGreaterThan(15);
    });
  }
});

describe("the blocks (L)", () => {
  const sets: Record<string, SeamAllowances[]> = {
    straight_skirt: [
      { default: 10 },
      { default: 15 },
      { default: 25 },
      { default: 15, edges: { b_cb: 0, f_cf: 0, b_hem: 40, f_hem: 40 } },
    ],
    bodice: [
      { default: 10 },
      { default: 15 },
      { default: 25 },
      { default: 15, edges: { b_cb: 0, f_cf: 0 } },
    ],
  };

  for (const [block, allowanceSets] of Object.entries(sets)) {
    const definition = JSON.parse(readFileSync(join(BLOCKS_DIR, `${block}.json`), "utf8"));
    for (const [profile, measurements] of Object.entries(PROFILES)) {
      for (const allowances of allowanceSets) {
        test(`${block} at ${profile} with ${JSON.stringify(allowances)}`, () => {
          const result = evaluatePattern(definition, { measurements });
          expect(result.ok).toBe(true);
          for (const piece of Object.values(result.pieces)) checkBlockPiece(piece, allowances);
        });
      }
    }
  }

  test("every block cubic but the back neckline is checked for smooth turning at 10 and 15 mm", () => {
    // The back neckline turns with a radius of under 4 mm at the shoulder: tighter than any
    // allowance, so its cutting line has a corner there and is not checked.
    let cubics = 0;
    let checked = 0;
    let necklines = 0;
    for (const block of Object.keys(sets)) {
      const definition = JSON.parse(readFileSync(join(BLOCKS_DIR, `${block}.json`), "utf8"));
      for (const measurements of Object.values(PROFILES)) {
        const result = evaluatePattern(definition, { measurements });
        for (const piece of Object.values(result.pieces)) {
          for (const allowances of [{ default: 10 }, { default: 15 }]) {
            cubics += piece.outline.filter((edge) => edge.type === "cubic").length;
            necklines += piece.outline.filter((edge) => edge.name === "b_neckline").length;
            checked += checkBlockPiece(piece, allowances);
          }
        }
      }
    }
    expect(necklines).toBe(6);
    expect(checked).toBe(cubics - necklines);
  });
});

/**
 * The properties of L for one block piece; returns how many cubic edges had their cutting-line
 * run checked for smooth one-way turning.
 */
function checkBlockPiece(piece: CuttingPiece, allowances: SeamAllowances): number {
  const outline = piece.outline as readonly Edge[];
  const line = points(cuttingLine(piece, allowances));
  const sign = Math.sign(polygonArea(outline.map((edge) => edge.from)));
  const darts = findDarts(outline, sign);
  const largest = Math.max(...outline.map((edge) => allowanceOf(allowances, edge.name)));
  const { near } = checkProperties(piece, allowances, line, {
    skipEdges: new Set(
      darts.flatMap((dart) => [dart.legIndex, (dart.legIndex + 1) % outline.length]),
    ),
    excluded: darts.flatMap((dart) => [
      { at: dart.x, radius: 2 * largest },
      { at: dart.y, radius: 2 * largest },
    ]),
  });

  // Zero-allowance edges lie on the cutting line, away from concave ends.
  outline.forEach((edge, index) => {
    if (allowanceOf(allowances, edge.name) !== 0) return;
    const ends = [index, (index + 1) % outline.length].map((next) => {
      const previous = outline[(next + outline.length - 1) % outline.length]!;
      const following = outline[next]!;
      const t1 = p(
        previous.to.x - (previous.type === "cubic" ? previous.c2.x : previous.from.x),
        previous.to.y - (previous.type === "cubic" ? previous.c2.y : previous.from.y),
      );
      const t2 = p(
        (following.type === "cubic" ? following.c1.x : following.to.x) - following.from.x,
        (following.type === "cubic" ? following.c1.y : following.to.y) - following.from.y,
      );
      return { at: following.from, concave: cross(t1, t2) * sign < 0 };
    });
    for (const sample of reference([edge])) {
      if (ends.some((end) => end.concave && distance(end.at, sample.point) < MITER_LIMIT * largest))
        continue;
      expect(polygonDistance(line, sample.point)).toBeLessThan(TOLERANCE);
    }
  });

  // The run of each gently curved cubic turns one way, by at most 10 degrees per step.
  let checked = 0;
  outline.forEach((edge, index) => {
    if (edge.type !== "cubic") return;
    const a = allowanceOf(allowances, edge.name);
    if (!(minRadius(edge) > a)) return;
    const run = line.filter(
      (_, i) => near[i]!.edge === index && near[i]!.t > 0.01 && near[i]!.t < 0.99,
    );
    expect(run.length).toBeGreaterThan(2);
    const steps = turns(run);
    expect(steps.every((turn) => turn >= -1e-9) || steps.every((turn) => turn <= 1e-9)).toBe(true);
    expect(Math.max(...steps.map(Math.abs))).toBeLessThanOrEqual(10);
    checked++;
  });
  return checked;
}

describe("fuzz: star polygons with curves and mixed allowances (M)", () => {
  test("100 seeded pieces give simple lines at the right distance", () => {
    const next = random(9);
    let skipped = 0;
    for (let round = 0; round < 100; round++) {
      const count = 8 + Math.floor(next() * 17);
      const corners = Array.from({ length: count }, (_, i) => {
        const angle = ((i + 0.3 * (next() - 0.5)) / count) * 2 * Math.PI;
        const radius = 170 + next() * 80;
        return p(300 + radius * Math.cos(angle), 300 + radius * Math.sin(angle));
      });
      const outline: Edge[] = corners.map((from, i) => {
        const to = corners[(i + 1) % count]!;
        if (next() < 0.5) return { name: `e${i}`, type: "line", from, to };
        const normal = p(-(to.y - from.y), to.x - from.x);
        const bulge1 = (next() - 0.5) * 0.8;
        const bulge2 = (next() - 0.5) * 0.8;
        return {
          name: `e${i}`,
          type: "cubic",
          from,
          c1: p(
            from.x + (to.x - from.x) / 3 + normal.x * bulge1,
            from.y + (to.y - from.y) / 3 + normal.y * bulge1,
          ),
          c2: p(
            from.x + (2 * (to.x - from.x)) / 3 + normal.x * bulge2,
            from.y + (2 * (to.y - from.y)) / 3 + normal.y * bulge2,
          ),
          to,
        };
      });
      const edges: Record<string, number> = {};
      for (const edge of outline) if (next() < 0.5) edges[edge.name] = Math.round(next() * 40);
      const allowances = { default: Math.round(next() * 40), edges };
      const piece = next() < 0.5 ? { outline } : reversePiece({ outline });
      const samples = reference(piece.outline, 128);
      // Bulging curves can make the outline cross itself near a sharp corner; that is no piece.
      if (findCrossings(samples.map((sample) => sample.point)).length > 0) {
        skipped++;
        continue;
      }
      const sign = Math.sign(polygonArea(piece.outline.map((edge) => edge.from)));
      expect(findDarts(piece.outline, sign)).toEqual([]);

      const result = cuttingLine(piece, allowances);
      if (!result.ok) throw new Error(`round ${round}: ${JSON.stringify(result.errors)}`);
      const line = result.points;
      expect(selfIntersects(line)).toBe(false);
      expect(Math.sign(polygonArea(line))).toBe(sign);
      for (const sample of samples.filter((_, i) => i % 4 === 0)) {
        if (!insidePolygon(line, sample.point.x, sample.point.y)) {
          expect(polygonDistance(line, sample.point)).toBeLessThan(TOLERANCE);
        }
      }
      const used = piece.outline.map((edge) => allowanceOf(allowances, edge.name));
      const smallest = Math.min(...used);
      const largest = Math.max(...used);
      for (const point of line) {
        const found = nearest(samples, point).distance;
        expect(found).toBeGreaterThanOrEqual(smallest - TOLERANCE);
        expect(found).toBeLessThanOrEqual(reach(largest));
      }
    }
    expect(skipped).toBeLessThan(5);
  }, 60_000);
});

/** `count` corners alternating between radius `outer` and `inner` around (0, 0). */
function starCorners(count: number, outer: number, inner: number): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 2 * Math.PI;
    const radius = i % 2 === 0 ? outer : inner;
    return p(radius * Math.cos(angle), radius * Math.sin(angle));
  });
}

/** A comb of `teeth` teeth `width` wide and `height` long, `gap` apart, on a 50 mm back. */
function combCorners(teeth: number, width: number, gap: number, height: number): Point[] {
  const corners: Point[] = [];
  let x = 0;
  for (let tooth = 0; tooth < teeth; tooth++) {
    corners.push(p(x, 0), p(x + width, 0), p(x + width, height));
    x += width + gap;
    corners.push(p(x, height));
  }
  corners.push(p(x, 0), p(x + width, 0), p(x + width, height + 50), p(0, height + 50));
  return corners;
}

/** Rows of wavy cubics `gap` apart, joined at alternating ends, closed along the left. */
function serpentine(rows: number, length: number, gap: number, wave: number): CuttingPiece {
  const outline: Edge[] = [];
  let at = p(0, 0);
  for (let row = 0; row < rows; row++) {
    const y = row * gap;
    const to = p(row % 2 === 0 ? length : 50, y);
    const third = (to.x - at.x) / 3;
    outline.push({
      name: `r${row}`,
      type: "cubic",
      from: at,
      c1: p(at.x + third, y + wave),
      c2: p(at.x + 2 * third, y - wave),
      to,
    });
    const down = p(to.x, y + gap);
    outline.push({ name: `v${row}`, type: "line", from: to, to: down });
    at = down;
  }
  outline.push({ name: "bottom", type: "line", from: at, to: p(0, at.y) });
  outline.push({ name: "left", type: "line", from: p(0, at.y), to: p(0, 0) });
  return { outline };
}

describe("input robustness (N)", () => {
  const square = polygonPiece([p(0, 0), p(100, 0), p(100, 100), p(0, 100)]);
  const call = (allowances: unknown, piece: unknown = square) =>
    cuttingLine(piece as CuttingPiece, allowances as SeamAllowances);

  test("bad allowance objects give invalid_seam_allowance without an edge", () => {
    for (const bad of [
      null,
      undefined,
      5,
      "10",
      {},
      { default: -1 },
      { default: Number.NaN },
      { default: Infinity },
      { default: MAX_SEAM_ALLOWANCE + 1 },
      { default: "10" },
      { default: 10, edges: null },
      { default: 10, edges: 5 },
      { default: 10, edges: [1] },
    ]) {
      const result = call(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]!.kind).toBe("invalid_seam_allowance");
        expect("edge" in result.errors[0]!).toBe(false);
      }
    }
    expect(call({ default: MAX_SEAM_ALLOWANCE }).ok).toBe(true);
    expect(call({ default: 0, edges: {} }).ok).toBe(true);
  });

  test("every bad edge value is its own error naming the edge, also for unknown names", () => {
    const result = call({
      default: 10,
      edges: { e0: -1, e1: Number.NaN, nowhere: Infinity, e2: "5", e3: 101, fine: 20 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.map((error) => (error.kind === "invalid_seam_allowance" ? error.edge : null)),
      ).toEqual(["e0", "e1", "nowhere", "e2", "e3"]);
    }
    const both = call({ default: -5, edges: { e0: -1 } });
    expect(both.ok ? 0 : both.errors.length).toBe(2);
  });

  test("a huge edge map is one error, errors are capped and long names cut short", () => {
    const huge: Record<string, number> = {};
    for (let i = 0; i <= MAX_SECTION_ENTRIES; i++) huge[`k${i}`] = 10;
    expect(call({ default: 10, edges: huge })).toEqual({
      ok: false,
      errors: [
        {
          kind: "invalid_seam_allowance",
          message: `The seam allowances per edge must have at most ${MAX_SECTION_ENTRIES} entries`,
        },
      ],
    });
    const bad: Record<string, number> = {};
    for (let i = 0; i < 2 * MAX_ALLOWANCE_ERRORS; i++) bad[`k${i}`] = -1;
    const capped = call({ default: -1, edges: bad });
    expect(capped.ok ? 0 : capped.errors.length).toBe(MAX_ALLOWANCE_ERRORS);
    const long = "x".repeat(10_000);
    const result = call({ default: 10, edges: { [long]: -1 } });
    expect(result.ok ? null : result.errors[0]).toEqual({
      kind: "invalid_seam_allowance",
      edge: long,
      message: `The seam allowance of "${"x".repeat(80)}..." must be a number from 0 to 100 mm`,
    });
  });

  test("names not in the outline are ignored; prototype keys are plain names", () => {
    const plain = points(call({ default: 10 }));
    expect(points(call({ default: 10, edges: { elsewhere: 50 } }))).toEqual(plain);
    const parsed = JSON.parse(
      '{"default": 10, "edges": {"__proto__": 50, "constructor": 30, "toString": 1}}',
    );
    expect(points(call(parsed))).toEqual(plain);
    const badProto = JSON.parse('{"default": 10, "edges": {"__proto__": -1}}');
    const result = call(badProto);
    expect(result.ok ? null : result.errors[0]).toMatchObject({
      kind: "invalid_seam_allowance",
      edge: "__proto__",
    });
  });

  test("getters that throw are reported, not thrown", () => {
    const throwingDefault = Object.defineProperty({}, "default", {
      enumerable: true,
      get: () => {
        throw new Error("no");
      },
    });
    expect(call(throwingDefault).ok).toBe(false);
    const throwingEdges = {
      default: 10,
      get edges(): never {
        throw new Error("no");
      },
    };
    expect(call(throwingEdges).ok).toBe(false);
    const throwingEdge = {
      default: 10,
      edges: Object.defineProperty({}, "e0", {
        enumerable: true,
        get: () => {
          throw new Error("no");
        },
      }),
    };
    const result = call(throwingEdge);
    expect(result.ok ? null : result.errors[0]).toMatchObject({
      kind: "invalid_seam_allowance",
      edge: "e0",
    });
    const proxy = {
      default: 10,
      edges: new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error("no");
          },
        },
      ),
    };
    expect(call(proxy).ok).toBe(false);
  });

  test("degenerate pieces give degenerate_geometry, never a throw", () => {
    const degenerate = (piece: unknown) => {
      const result = call({ default: 10 }, piece);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]!.kind).toBe("degenerate_geometry");
    };
    degenerate(null);
    degenerate({});
    degenerate({ outline: [] });
    degenerate({ outline: "nope" });
    degenerate({ outline: [null] });
    degenerate(polygonPiece([p(0, 0), p(50, 0), p(100, 0)]));
    degenerate(polygonPiece([p(0, 0), p(Number.NaN, 0), p(100, 100)]));
    degenerate(polygonPiece([p(0, 0), p(100, 0), p(100, 2 * MAX_COORDINATE)]));
    degenerate({
      outline: [{ name: "c", type: "cubic", from: p(0, 0), c1: p(1, 1), to: p(0, 0) }],
    });
    // Open: the second edge does not start where the first ends.
    degenerate({
      outline: [
        { name: "a", type: "line", from: p(0, 0), to: p(100, 0) },
        { name: "b", type: "line", from: p(100, 5), to: p(0, 0) },
      ],
    });
    // A figure eight: the outline crosses itself.
    degenerate(polygonPiece([p(0, 0), p(100, 100), p(100, 0), p(0, 100)]));
    // A square with a small loop at its last corner, crossing the first edge: rejected at every
    // allowance, not only where the line built around it happens to fail its checks.
    const bowTie = polygonPiece([p(0, 0), p(100, 0), p(100, 100), p(0, 100), p(5, -5)]);
    for (const allowance of [0, 1, 5, 10, 15, 40, MAX_SEAM_ALLOWANCE]) {
      const result = cuttingLine(bowTie, { default: allowance });
      expect(result).toEqual({
        ok: false,
        errors: [
          {
            kind: "degenerate_geometry",
            message: "The outline crosses itself, so it has no cutting line",
          },
        ],
      });
    }
    // An outline whose getter throws.
    degenerate({
      get outline(): never {
        throw new Error("no");
      },
    });
  });

  test("odd but readable pieces still give a line", () => {
    // An unknown curve type counts as a line; point-like edges are skipped.
    const odd = {
      outline: [
        { name: "a", type: "arc", from: p(0, 0), to: p(100, 0) },
        { name: "dot", type: "line", from: p(100, 0), to: p(100, 0) },
        { name: "b", type: "line", from: p(100, 0), to: p(100, 100) },
        { name: "c", type: "line", from: p(100, 100), to: p(0, 0) },
      ],
    };
    expect(call({ default: 10 }, odd).ok).toBe(true);
    // A single cubic closing on itself.
    const drop = {
      outline: [
        { name: "d", type: "cubic", from: p(0, 0), c1: p(100, -60), c2: p(100, 60), to: p(0, 0) },
      ],
    };
    const line = points(call({ default: 10 }, drop));
    expect(selfIntersects(line)).toBe(false);
    // Coordinates at the bound.
    const big = polygonPiece([
      p(-MAX_COORDINATE, -MAX_COORDINATE),
      p(MAX_COORDINATE, -MAX_COORDINATE),
      p(MAX_COORDINATE, MAX_COORDINATE),
      p(-MAX_COORDINATE, MAX_COORDINATE),
    ]);
    const result = call({ default: 100 }, big);
    expect(result.ok ? result.points.length : result.errors[0]!.kind).toBe(
      result.ok ? 4 : "degenerate_geometry",
    );
  });

  test("the flattening budget holds when many short cubics share it with a few long ones", () => {
    // 40 bulging cubics that want MAX_CUBIC_SEGMENTS each and 960 straight cubics that want one:
    // more than the budget together, so the long ones are scaled down. At allowance 0 the line is
    // the flattened outline, one point per segment.
    const count = 1000;
    const corners = Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * 2 * Math.PI;
      return p(1e6 * Math.cos(angle), 1e6 * Math.sin(angle));
    });
    const outline: Edge[] = corners.map((from, i) => {
      const to = corners[(i + 1) % count]!;
      const bulge = i % 25 === 0 ? 5000 / 1e6 : 0;
      const out = p((from.x + to.x) * bulge * 0.5, (from.y + to.y) * bulge * 0.5);
      return {
        name: `c${i}`,
        type: "cubic",
        from,
        c1: p(from.x + (to.x - from.x) / 3 + out.x, from.y + (to.y - from.y) / 3 + out.y),
        c2: p(
          from.x + (2 * (to.x - from.x)) / 3 + out.x,
          from.y + (2 * (to.y - from.y)) / 3 + out.y,
        ),
        to,
      };
    });
    expect(outline.reduce((sum, edge) => sum + cubicSegments(edge, 0), 0)).toBeGreaterThan(
      MAX_CUTTING_LINE_SEGMENTS,
    );
    expect(points(cuttingLine({ outline }, { default: 0 })).length).toBeLessThanOrEqual(
      MAX_CUTTING_LINE_SEGMENTS,
    );
  });

  test("an outline with more than MAX_OUTLINE_ENTRIES edges is refused before any work", () => {
    const corners = Array.from({ length: MAX_OUTLINE_ENTRIES + 1 }, (_, i) => {
      const angle = (i / (MAX_OUTLINE_ENTRIES + 1)) * 2 * Math.PI;
      return p(1000 * Math.cos(angle), 1000 * Math.sin(angle));
    });
    expect(cuttingLine(polygonPiece(corners), { default: 10 })).toEqual({
      ok: false,
      errors: [
        {
          kind: "degenerate_geometry",
          message: `The outline has more than ${MAX_OUTLINE_ENTRIES} edges`,
        },
      ],
    });
    expect(cuttingLine(polygonPiece(corners.slice(1)), { default: 10 }).ok).toBe(true);
  });

  // Hostile outlines at the entry limit, at the largest allowance: each either gives a line of
  // bounded size or is refused as too complex, quickly. The limits cap the crossings, the pairs of
  // segments compared and the raw line; without them, outlines like these with more edges took
  // tens of seconds and gigabytes.
  const hostile: [string, CuttingPiece][] = [
    ["a star of 499 thin spikes", polygonPiece(starCorners(998, 5000, 100))],
    ["a star of 499 short spikes", polygonPiece(starCorners(998, 110, 100))],
    ["a comb of 249 thin teeth", polygonPiece(combCorners(249, 1, 1, 100))],
    ["a comb of 249 wide teeth", polygonPiece(combCorners(249, 50, 50, 1000))],
    ["a serpentine of 499 wavy rows", serpentine(499, 3000, 30, 10)],
  ];
  for (const [label, piece] of hostile) {
    test(`${label} at ${MAX_SEAM_ALLOWANCE} mm stays within the work limits`, () => {
      expect(piece.outline.length).toBeLessThanOrEqual(MAX_OUTLINE_ENTRIES);
      const started = performance.now();
      const result = cuttingLine(piece, { default: MAX_SEAM_ALLOWANCE });
      // Generous for slow CI machines; on a laptop each takes about 0.2 s at most.
      expect(performance.now() - started).toBeLessThan(3000);
      if (result.ok) {
        expect(result.points.length).toBeLessThanOrEqual(MAX_RAW_LINE_POINTS);
        expect(selfIntersects(result.points)).toBe(false);
      } else {
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]!.kind).toBe("degenerate_geometry");
      }
    });
  }

  test("the serpentine is refused as too complex, not as crossing itself", () => {
    const result = cuttingLine(serpentine(499, 3000, 30, 10), { default: MAX_SEAM_ALLOWANCE });
    expect(result).toEqual({
      ok: false,
      errors: [
        { kind: "degenerate_geometry", message: "The piece is too complex for a cutting line" },
      ],
    });
  });

  test("an outline of 1000 large cubics finishes within the segment budget", () => {
    const count = 1000;
    const corners = Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * 2 * Math.PI;
      return p(5e6 * Math.cos(angle), 5e6 * Math.sin(angle));
    });
    const outline: Edge[] = corners.map((from, i) => {
      const to = corners[(i + 1) % count]!;
      return {
        name: `c${i}`,
        type: "cubic",
        from,
        c1: p(from.x * 1.5, from.y * 1.5),
        c2: p(to.x * 0.5, to.y * 0.5),
        to,
      };
    });
    const result = cuttingLine({ outline }, { default: 50 });
    if (result.ok) expect(result.points.length).toBeLessThanOrEqual(3 * MAX_CUTTING_LINE_SEGMENTS);
    else expect(result.errors[0]!.kind).toBe("degenerate_geometry");
  });
});
