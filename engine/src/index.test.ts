import { expect, test } from "bun:test";
import { distance, evaluateFormulas } from "./index";

test("distance between two points", () => {
  expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
});

test("formulas are evaluated through the package entry point", () => {
  expect(
    evaluateFormulas({
      measurements: { waist: 720 },
      parameters: { ease_waist: 10 },
      formulas: { front_waist: "waist / 4 + ease_waist" },
    }),
  ).toEqual({ ok: true, values: { waist: 720, ease_waist: 10, front_waist: 190 } });
});
