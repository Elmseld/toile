import { describe, expect, test } from "bun:test";
import { DEFAULT_SEAM_ALLOWANCE, MAX_SEAM_ALLOWANCE } from "../geometry/seam-allowance";
import type { ComputedCurve, ComputedPiece } from "../geometry/types";
import type { Point } from "../geometry/vector";
import {
  edgeAllowance,
  pickEdge,
  type ProjectSeamAllowances,
  readSeamAllowances,
  setDefaultAllowance,
  setEdgeAllowance,
} from "./edges";

const p = (x: number, y: number): Point => ({ x, y });
const line = (name: string, from: Point, to: Point): ComputedCurve => ({
  name,
  type: "line",
  from,
  to,
  length: Math.hypot(to.x - from.x, to.y - from.y),
});

// A 100 x 50 rectangle whose right edge bulges out to about x = 130 at mid-height.
const piece: Pick<ComputedPiece, "outline"> = {
  outline: [
    line("top", p(0, 0), p(100, 0)),
    { name: "side", type: "cubic", from: p(100, 0), c1: p(140, 10), c2: p(140, 40), to: p(100, 50), length: 0 },
    line("hem", p(100, 50), p(0, 50)),
    line("cf", p(0, 50), p(0, 0)),
  ],
};

describe("pickEdge", () => {
  test("finds the nearest line within the radius", () => {
    expect(pickEdge({ front: piece }, p(50, 2), 5)).toEqual({ piece: "front", curve: "top" });
    expect(pickEdge({ front: piece }, p(-3, 25), 5)).toEqual({ piece: "front", curve: "cf" });
  });

  test("measures a cubic along the curve, not its chord", () => {
    // The chord runs at x = 100, the curve's middle at x = 130.
    expect(pickEdge({ front: piece }, p(131, 25), 3)).toEqual({ piece: "front", curve: "side" });
    expect(pickEdge({ front: piece }, p(101, 25), 3)).toBeNull();
  });

  test("is null outside the radius, or with no pieces", () => {
    expect(pickEdge({ front: piece }, p(50, 25), 5)).toBeNull();
    expect(pickEdge({}, p(0, 0), 5)).toBeNull();
    expect(pickEdge({ front: piece }, p(50, 0), Number.NaN)).toBeNull();
  });

  test("gives a tie to the preferred curve, else the first", () => {
    const shared = { a: piece, b: { outline: [line("other", p(0, 0), p(100, 0))] } };
    expect(pickEdge(shared, p(50, 0), 1)).toEqual({ piece: "a", curve: "top" });
    expect(pickEdge(shared, p(50, 0), 1, "other")).toEqual({ piece: "b", curve: "other" });
    // At the corner, top and cf are equally near.
    expect(pickEdge({ front: piece }, p(-1, -1), 5)).toEqual({ piece: "front", curve: "top" });
    expect(pickEdge({ front: piece }, p(-1, -1), 5, "cf")).toEqual({ piece: "front", curve: "cf" });
  });
});

describe("readSeamAllowances", () => {
  test("reads a valid value as it is", () => {
    const raw = { default: 15.5, edges: { skirt: { f_cf: 0, b_side: 20 }, sleeve: { hem: 100 } } };
    expect(readSeamAllowances(raw)).toEqual(raw);
  });

  test("garbage becomes the default with no edges", () => {
    for (const raw of [null, undefined, 5, "x", [], {}, { default: "10" }, { default: -1 }]) {
      expect(readSeamAllowances(raw)).toEqual({ default: DEFAULT_SEAM_ALLOWANCE, edges: {} });
    }
    expect(readSeamAllowances({ default: MAX_SEAM_ALLOWANCE + 1 }).default).toBe(10);
    expect(readSeamAllowances({ default: Number.POSITIVE_INFINITY }).default).toBe(10);
    expect(readSeamAllowances({ default: 0, edges: [] })).toEqual({ default: 0, edges: {} });
  });

  test("drops invalid entries and parts left empty", () => {
    const raw = {
      default: 10,
      edges: {
        skirt: { a: 5, b: -0.5, c: 101, d: "10", e: null, f: Number.NaN, g: 100, h: 0 },
        bad: 3,
        list: [1, 2],
        empty: {},
        none: { x: -1 },
      },
    };
    expect(readSeamAllowances(raw)).toEqual({ default: 10, edges: { skirt: { a: 5, g: 100, h: 0 } } });
  });

  test("names such as __proto__ stay plain data, and inherited keys are not read", () => {
    const raw = JSON.parse('{"default": 10, "edges": {"__proto__": {"__proto__": 4}}}');
    const read = readSeamAllowances(raw);
    expect(Object.hasOwn(read.edges, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(read.edges)).toBe(Object.prototype);
    expect(Object.hasOwn(read.edges.__proto__!, "__proto__")).toBe(true);
    const inherited = Object.create({ default: 20, edges: { a: { b: 1 } } });
    expect(readSeamAllowances(inherited)).toEqual({ default: 10, edges: {} });
  });

  test("a hostile getter falls back to the default", () => {
    const hostile = {
      get default(): number {
        throw new Error("boom");
      },
    };
    expect(readSeamAllowances(hostile)).toEqual({ default: 10, edges: {} });
  });
});

describe("setDefaultAllowance and setEdgeAllowance", () => {
  const base: ProjectSeamAllowances = { default: 10, edges: { skirt: { f_cf: 0 }, sleeve: { hem: 20 } } };

  test("the same object when nothing changes", () => {
    expect(setDefaultAllowance(base, 10)).toBe(base);
    expect(setEdgeAllowance(base, "skirt", "f_cf", 0)).toBe(base);
    expect(setEdgeAllowance(base, "skirt", "b_side", null)).toBe(base);
    expect(setEdgeAllowance(base, "bodice", "b_cb", null)).toBe(base);
  });

  test("sets the default and keeps the edges", () => {
    const next = setDefaultAllowance(base, 15);
    expect(next).toEqual({ ...base, default: 15 });
    expect(next.edges).toBe(base.edges);
  });

  test("sets an edge, sharing the untouched part maps", () => {
    const next = setEdgeAllowance(base, "skirt", "b_side", 25);
    expect(next.edges).toEqual({ skirt: { f_cf: 0, b_side: 25 }, sleeve: { hem: 20 } });
    expect(next.edges.sleeve).toBe(base.edges.sleeve!);
    expect(Object.keys(next.edges)).toEqual(["skirt", "sleeve"]);
    const added = setEdgeAllowance(base, "bodice", "b_cb", 5);
    expect(added.edges).toEqual({ skirt: { f_cf: 0 }, sleeve: { hem: 20 }, bodice: { b_cb: 5 } });
  });

  test("null removes the user's value, and a part left empty is removed", () => {
    const next = setEdgeAllowance(base, "skirt", "f_cf", null);
    expect(next.edges).toEqual({ sleeve: { hem: 20 } });
    const two = setEdgeAllowance(base, "skirt", "b_side", 3);
    expect(setEdgeAllowance(two, "skirt", "f_cf", null).edges).toEqual({
      skirt: { b_side: 3 },
      sleeve: { hem: 20 },
    });
  });

  test("names such as __proto__ stay plain data", () => {
    const next = setEdgeAllowance(base, "__proto__", "__proto__", 1);
    expect(Object.hasOwn(next.edges, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(next.edges)).toBe(Object.prototype);
    expect(edgeAllowance(next, "__proto__", { folds: [] }, "__proto__")).toEqual({ value: 1, source: "edge" });
  });
});

describe("edgeAllowance", () => {
  const allowances: ProjectSeamAllowances = { default: 12, edges: { skirt: { b_side: 20, f_cf: 5 } } };

  test("the user's value, else 0 on a fold, else the default", () => {
    const front = { folds: ["f_cf", "f_other"] };
    expect(edgeAllowance(allowances, "skirt", front, "b_side")).toEqual({ value: 20, source: "edge" });
    expect(edgeAllowance(allowances, "skirt", front, "f_cf")).toEqual({ value: 5, source: "edge" });
    expect(edgeAllowance(allowances, "skirt", front, "f_other")).toEqual({ value: 0, source: "fold" });
    expect(edgeAllowance(allowances, "skirt", front, "hem")).toEqual({ value: 12, source: "default" });
    expect(edgeAllowance(allowances, "sleeve", { folds: [] }, "b_side")).toEqual({
      value: 12,
      source: "default",
    });
  });

  test("inherited names are not values", () => {
    expect(edgeAllowance(allowances, "skirt", { folds: [] }, "toString")).toEqual({
      value: 12,
      source: "default",
    });
    expect(edgeAllowance(allowances, "constructor", { folds: [] }, "name").source).toBe("default");
  });
});
