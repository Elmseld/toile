import { expect, test } from "bun:test";
import {
  compilePattern,
  cuttingLine,
  cuttingLinePathData,
  distance,
  evaluateFormulas,
  evaluatePattern,
  MAX_COORDINATE,
  MAX_SEAM_ALLOWANCE,
  piecePathData,
} from "./index";
import type {
  CuttingLineResult,
  CuttingPiece,
  DuplicateNameError,
  ElementSource,
  InvalidNameError,
  SeamAllowances,
} from "./index";

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

test("cutting lines are computed and drawn through the package entry point", () => {
  const corners = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ];
  const piece: CuttingPiece = {
    outline: corners.map((from, i) => ({
      name: `e${i}`,
      type: "line" as const,
      from,
      to: corners[(i + 1) % corners.length]!,
    })),
  };
  const allowances: SeamAllowances = { default: 10, edges: { e1: 0 } };
  const result: CuttingLineResult = cuttingLine(piece, allowances);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(cuttingLinePathData(result.points)).toBe("M -10 -10 L 100 -10 L 100 60 L -10 60 Z");
  }
  expect(MAX_SEAM_ALLOWANCE).toBe(100);
});
