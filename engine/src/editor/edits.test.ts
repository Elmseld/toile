import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PatternError } from "../geometry";
import {
  controlPoints,
  errorsFor,
  getPoint,
  pickPoint,
  pointFields,
  type RawDefinition,
  roundOffset,
  setPointFormula,
  setUserOffset,
  tryPattern,
} from "./index";

const BLOCKS_DIR = join(import.meta.dir, "..", "..", "blocks");

function block(name: string): RawDefinition {
  return JSON.parse(readFileSync(join(BLOCKS_DIR, `${name}.json`), "utf8"));
}

const SKIRT_INPUT = {
  measurements: { waist: 680, hip: 940, hip_height: 206, skirt_length: 600 },
};

const BODICE_INPUT = {
  measurements: {
    bust: 880,
    waist: 680,
    neck: 370,
    shoulder_width: 122,
    back_width: 344,
    chest_width: 324,
    back_length: 410,
    armhole_depth: 210,
    front_length: 445,
    bust_height: 265,
    bust_distance: 190,
  },
};

function points(definition: RawDefinition): Record<string, unknown>[] {
  return definition.points as Record<string, unknown>[];
}

function ok<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  if (!value.ok) throw new Error(`expected ok, got ${JSON.stringify(value)}`);
  return value as Extract<T, { ok: true }>;
}

describe("roundOffset", () => {
  test("rounds to 0.1 mm without a negative zero", () => {
    expect(roundOffset({ dx: 12.345, dy: -3.06 })).toEqual({ dx: 12.3, dy: -3.1 });
    expect(roundOffset({ dx: 0.15, dy: 0.25 })).toEqual({ dx: 0.2, dy: 0.3 });
    expect(Object.is(roundOffset({ dx: -0.04, dy: 0 }).dx, 0)).toBe(true);
  });
});

describe("setUserOffset", () => {
  test("replaces only that point and mutates nothing", () => {
    const skirt = block("straight_skirt");
    const before = structuredClone(skirt);
    const edited = setUserOffset(skirt, "b_hem_cb", { dx: 5.04, dy: 19.96 });

    expect(skirt).toEqual(before);
    expect(edited).not.toBe(skirt);
    expect(getPoint(edited, "b_hem_cb")).toEqual({
      name: "b_hem_cb",
      op: "offset",
      from: "b_waist_cb",
      dx: "0",
      dy: "finished_length",
      user_offset: { dx: 5, dy: 20 },
    });
    points(edited).forEach((point, i) => {
      if (point.name === "b_hem_cb") return;
      expect(point).toBe(points(skirt)[i] as Record<string, unknown>);
    });
    expect(edited.curves).toBe(skirt.curves);
    expect(edited.formulas).toBe(skirt.formulas);
  });

  test("null removes the offset", () => {
    const skirt = block("straight_skirt");
    const edited = setUserOffset(skirt, "b_hem_cb", { dx: 1, dy: 2 });
    const removed = setUserOffset(edited, "b_hem_cb", null);

    expect(getPoint(removed, "b_hem_cb")).toEqual(getPoint(skirt, "b_hem_cb"));
    expect(Object.hasOwn(getPoint(removed, "b_hem_cb") ?? {}, "user_offset")).toBe(false);
  });

  test("returns the definition itself when nothing changes", () => {
    const skirt = block("straight_skirt");
    expect(setUserOffset(skirt, "nope", { dx: 1, dy: 1 })).toBe(skirt);
    expect(setUserOffset(skirt, "b_hem_cb", null)).toBe(skirt);

    const edited = setUserOffset(skirt, "b_hem_cb", { dx: 1, dy: 2 });
    expect(setUserOffset(edited, "b_hem_cb", { dx: 1.01, dy: 1.96 })).toBe(edited);
  });

  test("moves dependent points and the outline by the same amount", () => {
    const skirt = block("straight_skirt");
    const base = ok(tryPattern(skirt, SKIRT_INPUT)).result;
    const moved = ok(tryPattern(setUserOffset(skirt, "b_hem_cb", { dx: 5, dy: 20 }), SKIRT_INPUT))
      .result;

    for (const name of ["b_hem_cb", "b_hem_side", "b_grain_bottom"]) {
      expect(moved.points[name]?.x).toBeCloseTo((base.points[name]?.x ?? 0) + 5, 9);
      expect(moved.points[name]?.y).toBeCloseTo((base.points[name]?.y ?? 0) + 20, 9);
    }
    expect(moved.points.b_hip_cb).toEqual(base.points.b_hip_cb as { x: number; y: number });
    expect(moved.basePoints.b_hem_cb).toEqual(base.points.b_hem_cb as { x: number; y: number });

    const hem = moved.pieces.back?.outline.find((curve) => curve.name === "b_hem");
    expect(hem?.to.y).toBeCloseTo((base.points.b_hem_cb?.y ?? 0) + 20, 9);
  });

  test("gives the same result as evaluating with the offset option", () => {
    const skirt = block("straight_skirt");
    const compiled = ok(tryPattern(skirt, SKIRT_INPUT)).compiled;
    const dragged = compiled.evaluate(SKIRT_INPUT, { offsets: { b_hem_cb: { dx: 5, dy: 20 } } });
    const committed = ok(
      tryPattern(setUserOffset(skirt, "b_hem_cb", { dx: 5, dy: 20 }), SKIRT_INPUT),
    ).result;

    expect(dragged.ok).toBe(true);
    expect(committed.points).toEqual(dragged.points);
    expect(committed.pieces).toEqual(dragged.pieces);
  });
});

describe("setPointFormula", () => {
  test("replaces one formula field", () => {
    const skirt = block("straight_skirt");
    const edited = setPointFormula(skirt, "b_hip_cb", "dy", "hip_height + 10");

    expect(getPoint(edited, "b_hip_cb")?.dy).toBe("hip_height + 10");
    expect(getPoint(skirt, "b_hip_cb")?.dy).toBe("hip_height");
    expect(points(edited)[0]).toBe(points(skirt)[0] as Record<string, unknown>);

    const result = ok(tryPattern(edited, SKIRT_INPUT)).result;
    expect(result.points.b_hip_cb?.y).toBe(216);
  });

  test("ignores name, line and which fields, unknown fields and unknown points", () => {
    const skirt = block("straight_skirt");
    expect(setPointFormula(skirt, "b_hip_cb", "from", "b_hem_cb")).toBe(skirt);
    expect(setPointFormula(skirt, "b_waist_side", "line", "b_hem_cb")).toBe(skirt);
    expect(setPointFormula(skirt, "b_waist_side", "which", "first")).toBe(skirt);
    expect(setPointFormula(skirt, "b_hip_cb", "distance", "1")).toBe(skirt);
    expect(setPointFormula(skirt, "b_hip_cb", "name", "x")).toBe(skirt);
    expect(setPointFormula(skirt, "nope", "dx", "1")).toBe(skirt);
    expect(setPointFormula(skirt, "b_hip_cb", "dy", "hip_height")).toBe(skirt);
  });
});

describe("pointFields", () => {
  test("lists the op's fields with their kinds", () => {
    const skirt = block("straight_skirt");
    expect(pointFields(getPoint(skirt, "b_waist_side") ?? { name: "" })).toEqual([
      { field: "line", kind: "line" },
      { field: "center", kind: "name" },
      { field: "radius", kind: "formula" },
      { field: "which", kind: "which" },
    ]);
  });

  test("is empty for an unknown or missing op", () => {
    expect(pointFields({ name: "A", op: "future" })).toEqual([]);
    expect(pointFields({ name: "A" })).toEqual([]);
    expect(pointFields({ name: "A", op: "__proto__" })).toEqual([]);
  });
});

describe("getPoint", () => {
  test("finds a point by name and tolerates odd definitions", () => {
    expect(getPoint(block("straight_skirt"), "b_hip_cb")?.op).toBe("offset");
    expect(getPoint(block("straight_skirt"), "nope")).toBeUndefined();
    expect(getPoint({}, "A")).toBeUndefined();
    expect(getPoint({ points: [null, 1, { name: "A" }] }, "A")).toEqual({ name: "A" });
  });
});

describe("controlPoints", () => {
  test("holds the c1/c2 points of the bodice's cubics and no curve end points", () => {
    const names = controlPoints(block("bodice"));
    expect([...names].sort()).toEqual(
      [
        "b_arm_c1",
        "b_arm_c2",
        "b_arm_c3",
        "b_arm_c4",
        "b_neck_c1",
        "b_neck_c2",
        "f_arm_c1",
        "f_arm_c2",
        "f_arm_c3",
        "f_arm_c4",
        "f_neck_c1",
        "f_neck_c2",
      ].sort(),
    );
    for (const end of ["b_nape", "b_neck", "b_shoulder", "b_width_pt", "f_chest"]) {
      expect(names.has(end)).toBe(false);
    }
  });

  test("tolerates odd definitions", () => {
    expect(controlPoints({}).size).toBe(0);
    expect(controlPoints({ curves: [null, { type: "cubic", c1: 1, c2: "B" }] })).toEqual(
      new Set(["B"]),
    );
  });

  test("moving a control point changes the armhole length the sleeve reads", () => {
    const bodice = block("bodice");
    const base = ok(tryPattern(bodice, BODICE_INPUT)).result;
    const edited = setUserOffset(bodice, "b_arm_c1", { dx: 15, dy: -10 });
    const moved = ok(tryPattern(edited, BODICE_INPUT)).result;

    expect(moved.curves.b_armhole_upper?.length).not.toBeCloseTo(
      base.curves.b_armhole_upper?.length ?? 0,
      3,
    );
    expect(moved.values.back_armhole_length).not.toBeCloseTo(
      base.values.back_armhole_length ?? 0,
      3,
    );
    expect(moved.values.armhole_length).toBeNumber();
  });
});

describe("tryPattern and errorsFor", () => {
  test("a syntax error belongs to the edited point and field", () => {
    const skirt = setPointFormula(block("straight_skirt"), "b_hip_cb", "dy", "waist / ");
    const tried = tryPattern(skirt, SKIRT_INPUT);
    if (tried.ok) throw new Error("expected errors");

    const own = errorsFor(tried.errors, "b_hip_cb", "dy");
    expect(own.map((error) => error.kind)).toEqual(["syntax"]);
    expect(errorsFor(tried.errors, "b_hip_cb", "dx")).toEqual([]);
    expect(errorsFor(tried.errors, "b_hip_cb")).toEqual(own);
  });

  test("a self-reference is a circular dependency", () => {
    const skirt = setPointFormula(
      block("straight_skirt"),
      "b_hip_cb",
      "dy",
      "distance(b_hip_cb, b_waist_cb)",
    );
    const tried = tryPattern(skirt, SKIRT_INPUT);
    if (tried.ok) throw new Error("expected errors");

    expect(errorsFor(tried.errors, "b_hip_cb", "dy").map((error) => error.kind)).toEqual([
      "circular_dependency",
    ]);
  });

  test("an evaluation error such as a missing measurement is not ok", () => {
    const tried = tryPattern(block("straight_skirt"), { measurements: {} });
    expect(tried.ok).toBe(false);
  });

  test("a line field matches its elements; errors without a name never match", () => {
    const errors: PatternError[] = [
      {
        kind: "wrong_reference_kind",
        name: "P",
        field: "line1/0",
        reference: "x",
        expected: "point",
        actual: "value",
        span: { start: 0, end: 1 },
        message: "",
      },
      { kind: "invalid_definition", path: "/points", message: "" },
      { kind: "no_intersection", name: "P", message: "" },
    ];
    expect(errorsFor(errors, "P", "line1")).toHaveLength(1);
    expect(errorsFor(errors, "P", "line")).toHaveLength(0);
    expect(errorsFor(errors, "P")).toHaveLength(2);
  });
});

describe("pickPoint", () => {
  const field = {
    A: { x: 0, y: 0 },
    B: { x: 10, y: 0 },
    C: { x: 10, y: 0 },
  };

  test("finds the nearest point within the radius", () => {
    expect(pickPoint(field, { x: 1, y: 1 }, 5)).toBe("A");
    expect(pickPoint(field, { x: 8, y: 0 }, 5)).toBe("B");
    expect(pickPoint(field, { x: 5, y: 0 }, 5)).toBe("A");
  });

  test("is null outside the radius", () => {
    expect(pickPoint(field, { x: 5, y: 10 }, 5)).toBeNull();
    expect(pickPoint({}, { x: 0, y: 0 }, 5)).toBeNull();
  });

  test("gives a tie to the preferred point, else the first", () => {
    expect(pickPoint(field, { x: 10, y: 1 }, 5)).toBe("B");
    expect(pickPoint(field, { x: 10, y: 1 }, 5, "C")).toBe("C");
    expect(pickPoint(field, { x: 1, y: 0 }, 5, "C")).toBe("A");
  });
});
