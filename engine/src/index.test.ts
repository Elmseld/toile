import { expect, test } from "bun:test";
import {
  compilePattern,
  distance,
  evaluateFormulas,
  evaluatePattern,
  MAX_COORDINATE,
  piecePathData,
} from "./index";
import type { DuplicateNameError, ElementSource, InvalidNameError } from "./index";

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

test("pattern definitions are evaluated and drawn through the package entry point", () => {
  const result = evaluatePattern(
    {
      version: 1,
      measurements: ["side"],
      points: [
        { name: "A", op: "start", x: "0", y: "0" },
        { name: "B", op: "along_angle", from: "A", angle: "0", distance: "side" },
        { name: "C", op: "perpendicular", from: "A", to: "B", distance: "side" },
      ],
      curves: [
        { name: "ab", type: "line", from: "A", to: "B" },
        { name: "bc", type: "line", from: "B", to: "C" },
        { name: "ca", type: "line", from: "C", to: "A" },
      ],
      pieces: [{ name: "t", outline: [{ curve: "ab" }, { curve: "bc" }, { curve: "ca" }], grainline: { from: "A", to: "C" } }],
    },
    { measurements: { side: 100 } },
  );
  expect(result.ok).toBe(true);
  const piece = result.pieces.t;
  expect(piece).toBeDefined();
  if (piece !== undefined) expect(piecePathData(piece)).toBe("M 0 0 L 100 0 L 0 100 L 0 0 Z");
});

test("pattern definitions can be compiled once through the package entry point", () => {
  const definition = {
    version: 1,
    measurements: ["side"],
    points: [{ name: "A", op: "start", x: "side", y: "0" }],
  };
  const compiled = compilePattern(definition);
  for (const side of [10, 20]) {
    const input = { measurements: { side } };
    expect(compiled.evaluate(input)).toEqual(evaluatePattern(definition, input));
  }
  expect(MAX_COORDINATE).toBe(1e7);
});

test("the name errors of a pattern result are typed through the package entry point", () => {
  const result = evaluatePattern(
    { version: 1, measurements: ["a", "a"], points: [{ name: "1x", op: "start", x: "0", y: "0" }] },
    { measurements: { a: 1 } },
  );
  const errors = result.ok ? [] : result.errors;
  const duplicate = errors.find(
    (error): error is DuplicateNameError<ElementSource> => error.kind === "duplicate_name",
  );
  const invalid = errors.find(
    (error): error is InvalidNameError<ElementSource> => error.kind === "invalid_name",
  );
  expect(duplicate?.name).toBe("a");
  expect(invalid?.name).toBe("1x");
});

test("editor helpers are exported through the package entry point", async () => {
  const engine = await import("./index");
  for (const name of [
    "setUserOffset",
    "setPointFormula",
    "pointFields",
    "controlPoints",
    "tryPattern",
    "errorsFor",
    "pickPoint",
    "createHistory",
    "push",
    "undo",
    "redo",
    "canUndo",
    "canRedo",
    "toDisplay",
    "fromDisplay",
    "formatDisplay",
  ]) {
    expect(typeof (engine as Record<string, unknown>)[name]).toBe("function");
  }
});
