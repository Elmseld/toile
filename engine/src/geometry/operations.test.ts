import { describe, expect, test } from "bun:test";
import {
  CURVE_FIELDS,
  computePoint,
  curveFields,
  OP_FIELDS,
  type OperationResult,
  pointFields,
} from "./operations";
import type { PointDefinition } from "./types";
import type { Point } from "./vector";

const POINTS: ReadonlyMap<string, Point> = new Map([
  ["O", { x: 0, y: 0 }],
  ["R", { x: 10, y: 0 }],
  ["D", { x: 0, y: 10 }],
  ["Q", { x: 3, y: 4 }],
  ["S", { x: 3, y: 4 }],
  ["U", { x: 0, y: 6 }],
  ["V", { x: 1, y: 6 }],
  ["T", { x: 10, y: 10 }],
  ["W", { x: 10, y: -10 }],
]);
const pointOf = (name: string): Point => POINTS.get(name) ?? { x: Number.NaN, y: Number.NaN };

function compute(point: PointDefinition, numbers: Record<string, number> = {}): OperationResult {
  return computePoint(point, new Map(Object.entries(numbers)), pointOf);
}

function expectPoint(result: OperationResult, x: number, y: number): void {
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.point.x).toBeCloseTo(x, 9);
  expect(result.point.y).toBeCloseTo(y, 9);
}

describe("start", () => {
  test("is (x, y)", () => {
    const point: PointDefinition = { name: "A", op: "start", x: "a", y: "b" };
    expect(compute(point, { x: 12.5, y: -3 })).toEqual({ ok: true, point: { x: 12.5, y: -3 } });
  });
});

describe("offset", () => {
  test("adds (dx, dy) to from, also negative", () => {
    const point: PointDefinition = { name: "A", op: "offset", from: "Q", dx: "1", dy: "2" };
    expectPoint(compute(point, { dx: 7, dy: -9 }), 10, -5);
  });
});

describe("along_line", () => {
  const point: PointDefinition = { name: "A", op: "along_line", from: "O", to: "Q", distance: "d" };

  test("goes the signed distance from from toward to", () => {
    expectPoint(compute(point, { distance: 2.5 }), 1.5, 2);
    // Past `to`.
    expectPoint(compute(point, { distance: 10 }), 6, 8);
    // Negative goes away from `to`.
    expectPoint(compute(point, { distance: -5 }), -3, -4);
  });

  test("coincident from and to is degenerate_geometry on to", () => {
    const same: PointDefinition = { ...point, from: "Q", to: "S" };
    const result = compute(same, { distance: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("degenerate_geometry");
      expect(result.error).toMatchObject({ field: "to" });
    }
  });
});

describe("along_angle", () => {
  const point: PointDefinition = { name: "A", op: "along_angle", from: "Q", angle: "a", distance: "d" };

  test("0, 90, 180 and 270 degrees are right, down, left and up, exactly", () => {
    expect(compute(point, { angle: 0, distance: 5 })).toEqual({ ok: true, point: { x: 8, y: 4 } });
    expect(compute(point, { angle: 90, distance: 5 })).toEqual({ ok: true, point: { x: 3, y: 9 } });
    expect(compute(point, { angle: 180, distance: 5 })).toEqual({ ok: true, point: { x: -2, y: 4 } });
    expect(compute(point, { angle: 270, distance: 5 })).toEqual({ ok: true, point: { x: 3, y: -1 } });
  });

  test("30 degrees, and a negative distance goes the opposite way", () => {
    expectPoint(compute(point, { angle: 30, distance: 10 }), 3 + 5 * Math.sqrt(3), 9);
    expectPoint(compute(point, { angle: 30, distance: -10 }), 3 - 5 * Math.sqrt(3), -1);
  });
});

describe("perpendicular", () => {
  test("positive is down for a rightward line", () => {
    const point: PointDefinition = { name: "A", op: "perpendicular", from: "O", to: "R", distance: "d" };
    expectPoint(compute(point, { distance: 4 }), 0, 4);
    expectPoint(compute(point, { distance: -4 }), 0, -4);
  });

  test("positive is left for a downward line", () => {
    const point: PointDefinition = { name: "A", op: "perpendicular", from: "O", to: "D", distance: "d" };
    expectPoint(compute(point, { distance: 4 }), -4, 0);
  });

  test("is erected at from on a slanted line", () => {
    const point: PointDefinition = { name: "A", op: "perpendicular", from: "O", to: "Q", distance: "d" };
    // Direction (0.6, 0.8) turned by +90 degrees is (-0.8, 0.6).
    expectPoint(compute(point, { distance: 5 }), -4, 3);
  });

  test("coincident from and to is degenerate_geometry on to", () => {
    const point: PointDefinition = { name: "A", op: "perpendicular", from: "Q", to: "S", distance: "d" };
    const result = compute(point, { distance: 4 });
    expect(result).toMatchObject({ ok: false, error: { kind: "degenerate_geometry", field: "to" } });
  });
});

describe("line_intersection", () => {
  test("intersects the two infinite lines", () => {
    const point: PointDefinition = {
      name: "A",
      op: "line_intersection",
      line1: ["O", "T"],
      line2: ["D", "R"],
    };
    expectPoint(compute(point), 5, 5);
    // Outside both segments.
    const outside: PointDefinition = { ...point, line1: ["O", "R"], line2: ["U", "T"] };
    expectPoint(compute(outside), -15, 0);
  });

  test("parallel and collinear lines are no_intersection", () => {
    const parallel: PointDefinition = {
      name: "A",
      op: "line_intersection",
      line1: ["O", "R"],
      line2: ["U", "V"],
    };
    expect(compute(parallel)).toMatchObject({ ok: false, error: { kind: "no_intersection" } });
    const collinear: PointDefinition = { ...parallel, line2: ["R", "O"] };
    expect(compute(collinear)).toMatchObject({ ok: false, error: { kind: "no_intersection" } });
  });

  test("a line with coincident points is degenerate_geometry on that line", () => {
    const first: PointDefinition = {
      name: "A",
      op: "line_intersection",
      line1: ["Q", "S"],
      line2: ["O", "R"],
    };
    expect(compute(first)).toMatchObject({
      ok: false,
      error: { kind: "degenerate_geometry", field: "line1" },
    });
    const second: PointDefinition = { ...first, line1: ["O", "R"], line2: ["S", "Q"] };
    expect(compute(second)).toMatchObject({
      ok: false,
      error: { kind: "degenerate_geometry", field: "line2" },
    });
  });
});

describe("line_circle_intersection", () => {
  const point: PointDefinition = {
    name: "A",
    op: "line_circle_intersection",
    line: ["U", "V"],
    center: "O",
    radius: "r",
    which: "first",
  };

  test("first and second are ordered along line[0] -> line[1]", () => {
    expectPoint(compute(point, { radius: 10 }), -8, 6);
    expectPoint(compute({ ...point, which: "second" }, { radius: 10 }), 8, 6);
    // Reversing the line swaps them.
    expectPoint(compute({ ...point, line: ["V", "U"] }, { radius: 10 }), 8, 6);
  });

  test("a tangent gives the same point for first and second", () => {
    expectPoint(compute(point, { radius: 6 }), 0, 6);
    expectPoint(compute({ ...point, which: "second" }, { radius: 6 }), 0, 6);
  });

  test("a line that misses the circle is no_intersection", () => {
    expect(compute(point, { radius: 5 })).toMatchObject({
      ok: false,
      error: { kind: "no_intersection" },
    });
  });

  test("a negative radius is degenerate_geometry on radius", () => {
    expect(compute(point, { radius: -1 })).toMatchObject({
      ok: false,
      error: { kind: "degenerate_geometry", field: "radius" },
    });
  });

  test("coincident line points are degenerate_geometry on line", () => {
    expect(compute({ ...point, line: ["Q", "S"] }, { radius: 10 })).toMatchObject({
      ok: false,
      error: { kind: "degenerate_geometry", field: "line" },
    });
  });
});

describe("midpoint", () => {
  test("is halfway between from and to", () => {
    const point: PointDefinition = { name: "A", op: "midpoint", from: "R", to: "W" };
    expect(compute(point)).toEqual({ ok: true, point: { x: 10, y: -5 } });
    // Coincident points give that point.
    expect(compute({ ...point, from: "Q", to: "S" })).toEqual({ ok: true, point: { x: 3, y: 4 } });
  });
});

describe("pointFields", () => {
  test("lists name and formula fields in edge order", () => {
    expect(
      pointFields({ name: "A", op: "along_angle", from: "B", angle: "a + 1", distance: "d" }),
    ).toEqual([
      ["from", "name", "B"],
      ["angle", "formula", "a + 1"],
      ["distance", "formula", "d"],
    ]);
  });

  test("addresses line elements as line/0 and line/1 and skips which", () => {
    expect(
      pointFields({
        name: "A",
        op: "line_circle_intersection",
        line: ["B", "C"],
        center: "D",
        radius: "r",
        which: "second",
      }),
    ).toEqual([
      ["line/0", "name", "B"],
      ["line/1", "name", "C"],
      ["center", "name", "D"],
      ["radius", "formula", "r"],
    ]);
  });

  test("follows OP_FIELDS for every op", () => {
    for (const [op, specs] of OP_FIELDS) {
      const point: Record<string, unknown> = { name: "A", op };
      for (const [field, kind] of specs) {
        point[field] = kind === "line" ? ["P", "Q"] : kind === "which" ? "first" : field;
      }
      const listed = pointFields(point as PointDefinition).map(([field]) => field.split("/")[0]);
      const expected = specs.flatMap(([field, kind]) =>
        kind === "which" ? [] : kind === "line" ? [field, field] : [field],
      );
      expect(listed).toEqual(expected);
    }
  });
});

describe("curveFields", () => {
  test("follows CURVE_FIELDS", () => {
    expect(curveFields({ name: "l", type: "line", from: "A", to: "B" })).toEqual([
      ["from", "A"],
      ["to", "B"],
    ]);
    expect(curveFields({ name: "c", type: "cubic", from: "A", c1: "B", c2: "C", to: "D" })).toEqual([
      ["from", "A"],
      ["c1", "B"],
      ["c2", "C"],
      ["to", "D"],
    ]);
    expect([...CURVE_FIELDS.keys()]).toEqual(["line", "cubic"]);
  });
});
