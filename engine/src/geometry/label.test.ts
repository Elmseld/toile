import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilePattern, placeLabel as publicPlaceLabel } from "../index";
import {
  CHAR_WIDTH_RATIO,
  GRAINLINE_ARROW_SIZE,
  grainlineSegments,
  insidePolygon,
  type LabelPiece,
  MIN_CLEARANCE_RATIO,
  MIN_SIZE_RATIO,
  outlinePolygon,
  placeLabel,
  rectSegmentDistance,
  textBox,
} from "./label";
import type { Bounds } from "./svg";
import type { Point } from "./vector";

const SIZE = 14;
const BLOCKS_DIR = join(import.meta.dir, "..", "..", "blocks");

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

const LABELS: Record<string, string> = { back: "Bakstycke", front: "Framstycke" };

type Segment = readonly [Point, Point];

/** A closed polygon of straight lines through `points`, with a grainline. */
function polygonPiece(points: Point[], grainline: { from: Point; to: Point }): LabelPiece {
  return {
    outline: points.map((from, i) => ({
      type: "line",
      from,
      to: points[(i + 1) % points.length]!,
    })),
    grainline,
  };
}

function boxAround(place: { x: number; y: number; size: number }, text: string): Bounds {
  const { width, height } = textBox(text, place.size);
  return {
    minX: place.x - width / 2,
    minY: place.y - height / 2,
    maxX: place.x + width / 2,
    maxY: place.y + height / 2,
  };
}

/**
 * The sides of the arrowhead triangles a view draws on `grainline`, computed here independently
 * of the module: tip on the end point, base GRAINLINE_ARROW_SIZE back along the line, as wide.
 */
function arrowheads(grainline: { from: Point; to: Point }): Segment[] {
  const { from, to } = grainline;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const u = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const triangle = (tip: Point, sign: number): Segment[] => {
    const base = {
      x: tip.x - sign * u.x * GRAINLINE_ARROW_SIZE,
      y: tip.y - sign * u.y * GRAINLINE_ARROW_SIZE,
    };
    const half = GRAINLINE_ARROW_SIZE / 2;
    const a = { x: base.x + u.y * half, y: base.y - u.x * half };
    const b = { x: base.x - u.y * half, y: base.y + u.x * half };
    return [
      [tip, a],
      [a, b],
      [b, tip],
    ];
  };
  return [...triangle(to, 1), ...triangle(from, -1)];
}

/** Every drawn line of `piece`: the flattened outline (darts included), grainline and arrows. */
function lines(piece: LabelPiece): Segment[] {
  const polygon = outlinePolygon(piece);
  return [
    ...polygon.map((p, i): Segment => [p, polygon[(i + 1) % polygon.length]!]),
    [piece.grainline.from, piece.grainline.to],
    ...arrowheads(piece.grainline),
  ];
}

function clearance(piece: LabelPiece, box: Bounds): number {
  return Math.min(...lines(piece).map(([a, b]) => rectSegmentDistance(box, a, b)));
}

function corners(box: Bounds): [number, number][] {
  return [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ];
}

describe("placeLabel on the blocks", () => {
  for (const block of ["straight_skirt", "bodice"]) {
    const definition = JSON.parse(readFileSync(join(BLOCKS_DIR, `${block}.json`), "utf8"));

    for (const [profile, measurements] of Object.entries(PROFILES)) {
      test(`${block}, ${profile}: each label lies inside its piece, clear of every line`, () => {
        const result = compilePattern(definition).evaluate({ measurements });
        expect(result.ok).toBe(true);

        for (const piece of Object.values(result.pieces)) {
          const text = LABELS[piece.name] ?? piece.name;
          const place = placeLabel(piece, text, SIZE)!;
          expect(place).not.toBeNull();

          const box = boxAround(place, text);
          const polygon = outlinePolygon(piece);
          for (const [x, y] of corners(box)) expect(insidePolygon(polygon, x, y)).toBe(true);
          expect(clearance(piece, box)).toBeCloseTo(place.clearance, 6);
          expect(place.clearance).toBeGreaterThanOrEqual(place.size * MIN_CLEARANCE_RATIO);
          // These pieces are large enough for the full size.
          expect(place.size).toBe(SIZE);
        }
      });
    }
  }
});

describe("placeLabel", () => {
  // 200 x 100 mm, a vertical grainline down the middle.
  const rectangle = polygonPiece(
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ],
    { from: { x: 100, y: 10 }, to: { x: 100, y: 90 } },
  );

  test("is part of the engine's public API", () => {
    expect(publicPlaceLabel).toBe(placeLabel);
  });

  test("moves the label off the grainline, into the middle of one half", () => {
    const place = placeLabel(rectangle, "Abc", SIZE)!;
    const { width } = textBox("Abc", SIZE);
    // Either half is as good; the scan keeps the first, the left one. The arrowheads at the ends
    // of the grainline are farther from it than the line itself.
    expect(place.x).toBeCloseTo(50, 0);
    expect(place.y).toBeCloseTo(50, 0);
    expect(place.clearance).toBeCloseTo(50 - width / 2, 0);
    expect(place.size).toBe(SIZE);
  });

  test("is deterministic", () => {
    expect(placeLabel(rectangle, "Abc", SIZE)).toEqual(placeLabel(rectangle, "Abc", SIZE));
  });

  test("keeps clear of the grainline arrowheads", () => {
    // A 1 mm grainline in the middle of a square: its arrowheads point outward from either end
    // and reach GRAINLINE_ARROW_SIZE back along it, so together they span 49.5 - 7 to 50.5 + 7.
    const grainline = { from: { x: 50, y: 49.5 }, to: { x: 50, y: 50.5 } };
    const piece = polygonPiece(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      grainline,
    );
    const text = "Abc";
    const place = placeLabel(piece, text, SIZE)!;
    const box = boxAround(place, text);
    const arrowGap = Math.min(
      ...arrowheads(grainline).map(([a, b]) => rectSegmentDistance(box, a, b)),
    );
    expect(arrowGap).toBeGreaterThanOrEqual(place.clearance - 1e-9);
    expect(clearance(piece, box)).toBeCloseTo(place.clearance, 6);
    // Halfway between the top edge and the arrowheads' far ends (42.5 or 57.5).
    expect(place.clearance).toBeCloseTo((42.5 - SIZE) / 2, 0);
  });

  test("keeps clear of notch marks", () => {
    // The label would sit in the middle of the left half; a long mark through it pushes it away.
    const mark = { from: { x: 50, y: 0 }, to: { x: 50, y: 60 } };
    const notched: LabelPiece = { ...rectangle, notches: [{ marks: [mark] }] };
    const place = placeLabel(notched, "Abc", SIZE)!;
    const box = boxAround(place, "Abc");
    expect(rectSegmentDistance(box, mark.from, mark.to)).toBeGreaterThanOrEqual(place.clearance - 1e-9);
    expect(place.x).not.toBeCloseTo(50, 0);
    // Non-finite marks are ignored.
    const odd = { from: { x: Number.NaN, y: 0 }, to: { x: 50, y: 60 } };
    expect(placeLabel({ ...rectangle, notches: [{ marks: [odd] }] }, "Abc", SIZE)).toEqual(
      placeLabel(rectangle, "Abc", SIZE),
    );
  });

  test("keeps clear of a dart cut into the outline", () => {
    // A square with a dart from the bottom edge up to (100, 120); grainline along the left.
    const piece = polygonPiece(
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 110, y: 200 },
        { x: 100, y: 120 },
        { x: 90, y: 200 },
        { x: 0, y: 200 },
      ],
      { from: { x: 20, y: 20 }, to: { x: 20, y: 180 } },
    );
    const text = "Bakstycke";
    const place = placeLabel(piece, text, SIZE)!;
    const box = boxAround(place, text);
    expect(box.maxY).toBeLessThan(120);
    expect(clearance(piece, box)).toBeGreaterThanOrEqual(SIZE * MIN_CLEARANCE_RATIO);
  });

  test("follows cubic edges", () => {
    // A lens: two cubics bulging up and down between (0, 0) and (300, 0).
    const left = { x: 0, y: 0 };
    const right = { x: 300, y: 0 };
    const piece: LabelPiece = {
      outline: [
        { type: "cubic", from: left, c1: { x: 50, y: -120 }, c2: { x: 250, y: -120 }, to: right },
        { type: "cubic", from: right, c1: { x: 250, y: 120 }, c2: { x: 50, y: 120 }, to: left },
      ],
      grainline: { from: { x: 150, y: -60 }, to: { x: 150, y: 60 } },
    };
    const place = placeLabel(piece, "Lens", SIZE)!;
    const box = boxAround(place, "Lens");
    const polygon = outlinePolygon(piece);
    for (const [x, y] of corners(box)) expect(insidePolygon(polygon, x, y)).toBe(true);
    expect(clearance(piece, box)).toBeGreaterThan(0);
  });

  test("shrinks the text in a narrow piece", () => {
    // 100 x 18 mm: a 14 mm label cannot keep its clearance, a smaller one can.
    const piece = polygonPiece(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 18 },
        { x: 0, y: 18 },
      ],
      { from: { x: 95, y: 3 }, to: { x: 95, y: 15 } },
    );
    const place = placeLabel(piece, "Ab", SIZE)!;
    expect(place.size).toBeLessThan(SIZE);
    expect(place.size).toBeGreaterThanOrEqual(SIZE * MIN_SIZE_RATIO);
    expect(place.clearance).toBeGreaterThanOrEqual(place.size * MIN_CLEARANCE_RATIO);
  });

  test("returns the best smallest placement when nothing keeps the clearance", () => {
    const piece = polygonPiece(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 8 },
        { x: 0, y: 8 },
      ],
      { from: { x: 98, y: 1 }, to: { x: 98, y: 7 } },
    );
    const place = placeLabel(piece, "Ab", SIZE)!;
    expect(place.clearance).toBeGreaterThan(0);
    expect(place.clearance).toBeLessThan(place.size * MIN_CLEARANCE_RATIO);
  });

  test("returns null for a piece without room for the text", () => {
    const sliver = polygonPiece(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 1 },
        { x: 0, y: 1 },
      ],
      { from: { x: 10, y: 0.5 }, to: { x: 90, y: 0.5 } },
    );
    expect(placeLabel(sliver, "Ab", SIZE)).toBeNull();
  });

  test("returns null for a degenerate outline", () => {
    const point = { x: 5, y: 5 };
    const grainline = { from: point, to: point };
    expect(placeLabel(polygonPiece([point, point], grainline), "A", SIZE)).toBeNull();
    const nonFinite = polygonPiece([{ x: NaN, y: 0 }, { x: 1, y: 1 }], grainline);
    expect(placeLabel(nonFinite, "A", SIZE)).toBeNull();
    // A flat outline has points but no area.
    const flat = polygonPiece(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
      grainline,
    );
    expect(placeLabel(flat, "A", SIZE)).toBeNull();
  });
});

describe("grainlineSegments", () => {
  test("is the line and an arrowhead at each end, tips on the end points, pointing outward", () => {
    const half = GRAINLINE_ARROW_SIZE / 2;
    const segments = grainlineSegments({ from: { x: 0, y: 0 }, to: { x: 0, y: 100 } });
    expect(segments).toHaveLength(7);
    expect(segments[0]).toEqual([{ x: 0, y: 0 }, { x: 0, y: 100 }]);
    const ends = segments.slice(1).flat();
    // The arrowhead at `to` has its base above the tip, the one at `from` below it.
    for (const corner of [
      { x: half, y: 100 - GRAINLINE_ARROW_SIZE },
      { x: -half, y: 100 - GRAINLINE_ARROW_SIZE },
      { x: half, y: GRAINLINE_ARROW_SIZE },
      { x: -half, y: GRAINLINE_ARROW_SIZE },
    ]) {
      const found = ends.some(
        (p) => Math.abs(p.x - corner.x) < 1e-9 && Math.abs(p.y - corner.y) < 1e-9,
      );
      expect(found).toBe(true);
    }
  });

  test("has no arrowheads on a grainline of zero length and nothing on a non-finite one", () => {
    const point = { x: 3, y: 4 };
    expect(grainlineSegments({ from: point, to: point })).toEqual([[point, point]]);
    expect(grainlineSegments({ from: { x: Infinity, y: 0 }, to: point })).toEqual([]);
  });
});

describe("textBox", () => {
  test("is the estimated text width by the font size", () => {
    expect(textBox("Framstycke", 10)).toEqual({ width: 10 * 10 * CHAR_WIDTH_RATIO, height: 10 });
    expect(textBox("", 10).width).toBe(10 * CHAR_WIDTH_RATIO);
  });
});

describe("rectSegmentDistance", () => {
  const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  test("is 0 for a segment that crosses or ends in the box", () => {
    expect(rectSegmentDistance(rect, { x: -5, y: 5 }, { x: 15, y: 5 })).toBe(0);
    expect(rectSegmentDistance(rect, { x: 5, y: 5 }, { x: 50, y: 50 })).toBe(0);
    expect(rectSegmentDistance(rect, { x: -5, y: 0 }, { x: 15, y: 0 })).toBe(0);
  });

  test("is the gap to a segment outside the box", () => {
    expect(rectSegmentDistance(rect, { x: 13, y: -20 }, { x: 13, y: 20 })).toBeCloseTo(3);
    expect(rectSegmentDistance(rect, { x: 13, y: 14 }, { x: 30, y: 30 })).toBeCloseTo(5);
    expect(rectSegmentDistance(rect, { x: 20, y: 0 }, { x: 0, y: 20 })).toBeCloseTo(0);
    expect(rectSegmentDistance(rect, { x: 30, y: 0 }, { x: 0, y: 30 })).toBeCloseTo(
      Math.hypot(5, 5),
    );
  });

  test("is the distance to a degenerate segment (a point)", () => {
    expect(rectSegmentDistance(rect, { x: 13, y: 14 }, { x: 13, y: 14 })).toBeCloseTo(5);
  });
});
