// Geometry functions for formulas (ADR 0004 decision 8): distance(A, B), angle(A, B), length(c).

import { FUNCTIONS, type FunctionSpec, type FunctionTable } from "../formula/functions";
import type { ComputedCurve } from "./types";
import { angleOf, distance, type Point } from "./vector";

/**
 * The geometry computed so far, read by the geometry functions each time they are applied (never
 * captured), so a caller may swap in fresh maps for every evaluation and reuse one table.
 */
export type GeometryState = {
  readonly points: ReadonlyMap<string, Point>;
  readonly curves: ReadonlyMap<string, ComputedCurve>;
};

/** What the name arguments of a geometry function must refer to. */
type NameKind = "point" | "curve";

/** Each geometry function with the kind of its name arguments and its spec over a state. */
const GEOMETRY_FUNCTIONS: readonly (readonly [
  name: string,
  kind: NameKind,
  spec: (state: GeometryState) => FunctionSpec,
])[] = [
  ["distance", "point", (state) => ofTwoPoints(state, distance)],
  ["angle", "point", (state) => ofTwoPoints(state, angleOf)],
  [
    "length",
    "curve",
    (state) => ({
      min: 1,
      max: 1,
      takes: "names",
      apply: (names) => {
        const name = names[0];
        return (name === undefined ? undefined : state.curves.get(name))?.length ?? Number.NaN;
      },
    }),
  ],
];

/** What the name arguments of each geometry function must refer to. */
export const NAME_ARGUMENT_KINDS: ReadonlyMap<string, NameKind> = new Map(
  GEOMETRY_FUNCTIONS.map(([name, kind]) => [name, kind] as const),
);

/**
 * A copy of `FUNCTIONS` plus `distance(A, B)` (mm), `angle(A, B)` (degrees, 0 = right, 90 = down,
 * in `[0, 360)`) and `length(c)` (mm, arc length for a cubic). They take bare names and read
 * `state` when applied, so they see final positions (user offsets included) as long as the caller
 * evaluates in dependency order. A name not (yet) in `state`, or coincident points for `angle`,
 * gives `NaN`, which the evaluator reports as `invalid_result` on the call.
 */
export function geometryFunctions(state: GeometryState): FunctionTable {
  return new Map([
    ...FUNCTIONS,
    ...GEOMETRY_FUNCTIONS.map(([name, , spec]) => [name, spec(state)] as const),
  ]);
}

function ofTwoPoints(state: GeometryState, measure: (a: Point, b: Point) => number): FunctionSpec {
  const point = (name: string | undefined): Point | undefined =>
    name === undefined ? undefined : state.points.get(name);
  return {
    min: 2,
    max: 2,
    takes: "names",
    apply: (names) => {
      const a = point(names[0]);
      const b = point(names[1]);
      return a === undefined || b === undefined ? Number.NaN : measure(a, b);
    },
  };
}
