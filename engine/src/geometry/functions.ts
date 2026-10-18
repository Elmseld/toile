// Geometry functions for formulas (ADR 0004 decision 8): distance(A, B), angle(A, B), length(c).

import { FUNCTIONS, type FunctionSpec, type FunctionTable } from "../formula/functions";
import type { ComputedCurve } from "./types";
import { angleOf, distance, type Point } from "./vector";

/** The geometry computed so far, read by the geometry functions when they are applied. */
export type GeometryState = {
  points: ReadonlyMap<string, Point>;
  curves: ReadonlyMap<string, ComputedCurve>;
};

/** What the name arguments of each geometry function must refer to. */
export const NAME_ARGUMENT_KINDS: ReadonlyMap<string, "point" | "curve"> = new Map([
  ["distance", "point"],
  ["angle", "point"],
  ["length", "curve"],
] as const);

/**
 * A copy of `FUNCTIONS` plus `distance(A, B)` (mm), `angle(A, B)` (degrees, 0 = right, 90 = down,
 * in `[0, 360)`) and `length(c)` (mm, arc length for a cubic). They take bare names and read
 * `state` when applied, so they see final positions (user offsets included) as long as the caller
 * evaluates in dependency order. A name not (yet) in `state`, or coincident points for `angle`,
 * gives `NaN`, which the evaluator reports as `invalid_result` on the call.
 */
export function geometryFunctions(state: GeometryState): FunctionTable {
  const point = (name: string | undefined): Point | undefined =>
    name === undefined ? undefined : state.points.get(name);
  const ofPoints =
    (measure: (a: Point, b: Point) => number) =>
    (names: readonly string[]): number => {
      const a = point(names[0]);
      const b = point(names[1]);
      return a === undefined || b === undefined ? Number.NaN : measure(a, b);
    };

  const geometry: [string, FunctionSpec][] = [
    ["distance", { min: 2, max: 2, takes: "names", apply: ofPoints(distance) }],
    ["angle", { min: 2, max: 2, takes: "names", apply: ofPoints(angleOf) }],
    [
      "length",
      {
        min: 1,
        max: 1,
        takes: "names",
        apply: (names) => {
          const name = names[0];
          return (name === undefined ? undefined : state.curves.get(name))?.length ?? Number.NaN;
        },
      },
    ],
  ];
  return new Map([...FUNCTIONS, ...geometry]);
}
