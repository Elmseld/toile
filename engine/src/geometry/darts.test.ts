import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Dart, dartCuttingLine, findDarts, MAX_DART_ANGLE } from "./darts";
import { evaluatePattern } from "./evaluate";
import { type Edge, polygonArea, reverseEdge } from "./offset";
import { cross, distance, type Point, reflectAcross, rotateAbout, sub, unit } from "./vector";

const BLOCKS_DIR = join(import.meta.dir, "..", "..", "blocks");
const EXAMPLE_PATH = join(import.meta.dir, "..", "..", "examples", "rectangle-with-dart.json");

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

/** A closed outline of straight lines through `points`, named e0, e1, ... */
function polygon(points: Point[]): Edge[] {
  return points.map((from, i) => ({
    name: `e${i}`,
    type: "line",
    from,
    to: points[(i + 1) % points.length]!,
  }));
}

function sign(outline: readonly Edge[]): number {
  return Math.sign(polygonArea(outline.map((edge) => edge.from)));
}

/** Distance from `point` to the infinite line through `a` and `b`. */
function lineDistance(point: Point, a: Point, b: Point): number {
  const d = unit(sub(b, a))!;
  return Math.abs(cross(d, sub(point, a)));
}

function indexNear(points: readonly Point[], target: Point, tolerance = 1e-9): number {
  return points.findIndex((point) => distance(point, target) <= tolerance);
}

// A 400 x 300 rectangle whose top edge has a dart of half-width W and depth H at x = 0.
const W = 10;
const H = 100;
const A = 10;
function dartedRectangle(): Edge[] {
  return polygon([p(-200, 0), p(-W, 0), p(0, H), p(W, 0), p(200, 0), p(200, 300), p(-200, 300)]);
}

describe("dartCuttingLine on a symmetric dart (E)", () => {
  const outline = dartedRectangle();
  const [dart] = findDarts(outline, 1);

  test("the peak points are exact", () => {
    expect(dart).toBeDefined();
    const theta = 2 * Math.atan(W / H);
    const P = p((-W * (H + A)) / H, -A);
    const Pm = p(0, H - (H + A) / Math.cos(theta));
    const openP = p((W * (H + A)) / H, -A);
    for (const press of ["before", "after"] as const) {
      const line = dartCuttingLine(dart!, A, A, 1, press)!;
      expect(line).not.toBeNull();
      const order = [P, Pm, openP].map((target) => indexNear(line, target));
      expect(order.every((index) => index >= 0)).toBe(true);
      expect(order[0]! < order[1]! && order[1]! < order[2]!).toBe(true);
      expect(distance(line[0]!, p(-200, -A))).toBeLessThan(1e-9);
      expect(distance(line[line.length - 1]!, p(200, -A))).toBeLessThan(1e-9);
      // Nothing above the peak, nothing below the seam's cutting line.
      for (const point of line) {
        expect(point.y).toBeGreaterThanOrEqual(Pm.y - 1e-9);
        expect(point.y).toBeLessThanOrEqual(-A + 1e-9);
      }
    }
  });

  test("works the same on a counter-clockwise outline", () => {
    const reversed = [...outline].reverse().map(reverseEdge);
    const [mirror] = findDarts(reversed, -1);
    expect(mirror).toBeDefined();
    const line = dartCuttingLine(mirror!, A, A, -1)!;
    const Pm = p(0, H - (H + A) / Math.cos(2 * Math.atan(W / H)));
    expect(indexNear(line, Pm)).toBeGreaterThan(0);
  });
});

describe("dartCuttingLine on an asymmetric dart (F)", () => {
  // S1 rises toward the dart, S2 is level; their allowances differ.
  const outline = polygon([
    p(-200, 80),
    p(-W, 0),
    p(0, H),
    p(W, 0),
    p(200, 0),
    p(200, 300),
    p(-200, 300),
  ]);
  const [dart] = findDarts(outline, 1);
  const a1 = 10;
  const a2 = 20;

  test("the unfolded flap lands on the closed seams' cutting line", () => {
    expect(dart).toBeDefined();
    const { apex, x, y } = dart!;
    const toY = unit(sub(y, apex))!;
    const toX = unit(sub(x, apex))!;
    const cos = toY.x * toX.x + toY.y * toX.y;
    const sin = cross(toY, toX);
    const close = (point: Point): Point => rotateAbout(point, apex, cos, sin);
    // The closed frame's cutting line: S1's offset line and S2's offset line, rotated.
    const s1a = p(-200, 80);
    const s2a = close(p(W, 0));
    const s2b = close(p(200, 0));
    const onClosedLine = (point: Point): boolean =>
      Math.abs(lineDistance(point, s1a, x) - a1) < 0.01 ||
      Math.abs(lineDistance(point, s2a, s2b) - a2) < 0.01;

    const line = dartCuttingLine(dart!, a1, a2, 1)!;
    const P = line.findIndex((point) => lineDistance(point, apex, x) < 1e-9 && point.y < 0);
    const middle = sub(p((x.x + y.x) / 2, (x.y + y.y) / 2), apex);
    const Pm = line.findIndex(
      (point) => lineDistance(point, apex, p(apex.x + middle.x, apex.y + middle.y)) < 1e-9,
    );
    const openP = line.findIndex((point, i) => i > Pm && lineDistance(point, apex, y) < 1e-9);
    expect(P).toBeGreaterThan(0);
    expect(Pm).toBeGreaterThan(P);
    expect(openP).toBeGreaterThan(Pm);
    for (let i = P; i <= Pm; i++) expect(onClosedLine(reflectAcross(line[i]!, apex, x))).toBe(true);
    for (let i = Pm; i <= openP; i++) expect(onClosedLine(close(line[i]!))).toBe(true);

    const after = dartCuttingLine(dart!, a1, a2, 1, "after")!;
    const differs =
      after.length !== line.length || after.some((point, i) => distance(point, line[i]!) > 0.01);
    expect(differs).toBe(true);
  });

  test("a seam before the dart too short to reach the flap edge is extended", () => {
    // S1 is 2 mm long: the flap edge ray meets its backward extension.
    const short = polygon([
      p(-W - 2, 0),
      p(-W, 0),
      p(0, H),
      p(W, 0),
      p(200, 0),
      p(200, 300),
      p(-W - 2, 300),
    ]);
    const [found] = findDarts(short, 1);
    const line = dartCuttingLine(found!, A, A, 1)!;
    expect(line).not.toBeNull();
    expect(distance(line[0]!, p(-W - 2, -A))).toBeLessThan(1e-9);
    const Pm = p(0, H - (H + A) / Math.cos(2 * Math.atan(W / H)));
    expect(indexNear(line, Pm)).toBeGreaterThan(0);
  });
});

describe("findDarts (G)", () => {
  test("finds a dart in both outline directions and at the wrap-around", () => {
    const outline = dartedRectangle();
    expect(findDarts(outline, 1).map((dart) => dart.legIndex)).toEqual([1]);
    const reversed = [...outline].reverse().map(reverseEdge);
    expect(findDarts(reversed, sign(reversed)).map((dart) => dart.leg1.name)).toEqual(["e2"]);
    // Rotated so that the legs are the last and the first entry.
    const rotated = [...outline.slice(2), ...outline.slice(0, 2)];
    const [wrapped] = findDarts(rotated, 1);
    expect(wrapped?.leg1.name).toBe("e1");
    expect(wrapped?.s1.name).toBe("e0");
    expect(wrapped?.s2.name).toBe("e3");
    expect(wrapped?.legIndex).toBe(rotated.length - 1);
  });

  test("rejects convex spikes, wide wedges, unequal and curved legs and short outlines", () => {
    const spike = polygon([
      p(-200, 0),
      p(-W, 0),
      p(0, -H),
      p(W, 0),
      p(200, 0),
      p(200, 300),
      p(-200, 300),
    ]);
    expect(findDarts(spike, 1)).toEqual([]);
    const wideHalf = H * Math.tan(((MAX_DART_ANGLE / 2 + 1) * Math.PI) / 180);
    const wide = polygon([
      p(-200, 0),
      p(-wideHalf, 0),
      p(0, H),
      p(wideHalf, 0),
      p(200, 0),
      p(200, 300),
      p(-200, 300),
    ]);
    expect(findDarts(wide, 1)).toEqual([]);
    const unequal = polygon([
      p(-200, 0),
      p(-W, 0),
      p(0, H),
      p(W + 5, -5),
      p(200, -5),
      p(200, 300),
      p(-200, 300),
    ]);
    expect(findDarts(unequal, 1)).toEqual([]);
    const curved = dartedRectangle();
    curved[1] = {
      name: "e1",
      type: "cubic",
      from: p(-W, 0),
      c1: p(-W, 30),
      c2: p(0, 70),
      to: p(0, H),
    };
    expect(findDarts(curved, 1)).toEqual([]);
    const triangle = polygon([p(-W, 0), p(0, H), p(W, 0)]);
    expect(findDarts(triangle, sign(triangle))).toEqual([]);
  });

  test("accepts legs equal within the tolerance and a wedge at the limit", () => {
    const nearly = polygon([
      p(-200, 0),
      p(-W, 0),
      p(0, H),
      p(W, -1.5),
      p(200, -1.5),
      p(200, 300),
      p(-200, 300),
    ]);
    expect(findDarts(nearly, 1).length).toBe(1);
    const half = H * Math.tan(((MAX_DART_ANGLE / 2 - 0.01) * Math.PI) / 180);
    const limit = polygon([
      p(-200, 0),
      p(-half, 0),
      p(0, H),
      p(half, 0),
      p(200, 0),
      p(200, 300),
      p(-200, 300),
    ]);
    expect(findDarts(limit, 1).length).toBe(1);
  });

  test("a second dart sharing a seam with the first is not a dart", () => {
    const outline = polygon([
      p(-200, 0),
      p(-60, 0),
      p(-50, H),
      p(-40, 0),
      p(0, 0),
      p(40, 0),
      p(50, H),
      p(60, 0),
      p(200, 0),
      p(200, 300),
      p(-200, 300),
    ]);
    // Seams: e0 | legs e1, e2 | e3 | e4 | legs e5, e6 | e7. Separate seams: both are darts.
    expect(findDarts(outline, 1).map((dart) => dart.legIndex)).toEqual([1, 5]);
    // Without the vertex in between, both darts would need e3: the second is rejected.
    const sharing = polygon([
      p(-200, 0),
      p(-60, 0),
      p(-50, H),
      p(-40, 0),
      p(40, 0),
      p(50, H),
      p(60, 0),
      p(200, 0),
      p(200, 300),
      p(-200, 300),
    ]);
    expect(findDarts(sharing, 1).map((dart) => dart.legIndex)).toEqual([1]);
    const shared = polygon([
      p(-200, 0),
      p(-60, 0),
      p(-50, H),
      p(-40, 0),
      p(-30, H),
      p(-20, 0),
      p(200, 0),
      p(200, 300),
      p(-200, 300),
    ]);
    // e1, e2 is a dart; e3, e4 would use e2 as its seam: rejected.
    const darts = findDarts(shared, 1);
    expect(darts.map((dart) => dart.legIndex)).toEqual([1]);
  });
});

describe("darts of the real definitions (H)", () => {
  const cases: [string, Record<string, string[][]>][] = [
    [
      join(BLOCKS_DIR, "straight_skirt.json"),
      {
        back: [["b_dart_leg_cb", "b_dart_leg_side"]],
        front: [["f_dart_leg_side", "f_dart_leg_cf"]],
      },
    ],
    [
      join(BLOCKS_DIR, "bodice.json"),
      {
        back: [
          ["b_sdart_leg_neck", "b_sdart_leg_arm"],
          ["b_wdart_leg_side", "b_wdart_leg_cb"],
        ],
        front: [
          ["f_wdart_leg_cf", "f_wdart_leg_side"],
          ["f_bdart_leg_arm", "f_bdart_leg_neck"],
        ],
      },
    ],
  ];
  for (const [path, expected] of cases) {
    const definition = JSON.parse(readFileSync(path, "utf8"));
    for (const [profile, measurements] of Object.entries(PROFILES)) {
      test(`${path.split("/").pop()} at ${profile}`, () => {
        const result = evaluatePattern(definition, { measurements });
        expect(result.ok).toBe(true);
        for (const [name, legs] of Object.entries(expected)) {
          const outline = result.pieces[name]!.outline as readonly Edge[];
          const darts = findDarts(outline, sign(outline));
          expect(darts.map((dart: Dart) => [dart.leg1.name, dart.leg2.name])).toEqual(legs);
          for (const dart of darts)
            expect(dartCuttingLine(dart, 15, 15, sign(outline))).not.toBeNull();
        }
      });
    }
  }

  for (const measurements of [
    { waist: 680, hip: 940, hip_height: 200 },
    { waist: 800, hip: 1080, hip_height: 210 },
  ]) {
    test(`the example definition at waist ${measurements.waist}`, () => {
      const result = evaluatePattern(JSON.parse(readFileSync(EXAMPLE_PATH, "utf8")), {
        measurements,
      });
      const outline = result.pieces.front!.outline as readonly Edge[];
      const darts = findDarts(outline, sign(outline));
      expect(darts.map((dart) => [dart.leg1.name, dart.leg2.name])).toEqual([
        ["dart_left", "dart_right"],
      ]);
    });
  }
});
