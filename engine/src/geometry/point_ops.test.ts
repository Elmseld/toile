import { describe, expect, test } from "bun:test";
import { OP_FIELDS } from "./operations";
import pointOps from "./point_ops.json";
import type { PointOp } from "./types";

// Every op of the `PointDefinition` union. `satisfies` makes the compiler reject a name that is
// not a `PointOp`; the test below rejects one that is missing.
const OPS = [
  "start",
  "offset",
  "along_line",
  "along_angle",
  "perpendicular",
  "line_intersection",
  "line_circle_intersection",
  "midpoint",
] as const satisfies readonly PointOp[];

describe("point_ops.json", () => {
  test("lists exactly the point ops, in order", () => {
    expect(Object.keys(pointOps)).toEqual([...OPS]);
    expect([...OP_FIELDS.keys()]).toEqual([...OPS]);
  });

  test("every field is a [field, kind] pair with a known kind", () => {
    for (const fields of Object.values(pointOps)) {
      expect(fields.length).toBeGreaterThan(0);
      for (const [field, kind, ...rest] of fields) {
        expect(rest).toEqual([]);
        expect(typeof field).toBe("string");
        expect(["name", "formula", "line", "which"]).toContain(String(kind));
      }
    }
  });

  test("OP_FIELDS holds the table as read", () => {
    expect(OP_FIELDS.get("along_angle")).toEqual([
      ["from", "name"],
      ["angle", "formula"],
      ["distance", "formula"],
    ]);
    expect(OP_FIELDS.get("__proto__")).toBeUndefined();
  });
});
