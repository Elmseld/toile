// The functions a formula may call. Angles are in degrees: sin/cos/tan take degrees and
// asin/acos/atan2 return degrees (ADR 0003). rad() and deg() convert for other maths.

/** Arity (`max: null` means unbounded) and implementation of a formula function. */
export type FunctionSpec = {
  min: number;
  max: number | null;
  apply: (args: readonly number[]) => number;
};

const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
const toDeg = (radians: number): number => (radians * 180) / Math.PI;

// Callers check arity before `apply`, so `args[i] ?? NaN` is only there for the type checker.
const unary = (fn: (x: number) => number): FunctionSpec => ({
  min: 1,
  max: 1,
  apply: (args) => fn(args[0] ?? Number.NaN),
});

/** Function table, keyed by name. A `Map`, so prototype members are never reachable by name. */
export const FUNCTIONS: ReadonlyMap<string, FunctionSpec> = new Map<string, FunctionSpec>([
  ["sqrt", unary(Math.sqrt)],
  ["abs", unary(Math.abs)],
  ["min", { min: 1, max: null, apply: (args) => Math.min(...args) }],
  ["max", { min: 1, max: null, apply: (args) => Math.max(...args) }],
  ["sin", unary((x) => Math.sin(toRad(x)))],
  ["cos", unary((x) => Math.cos(toRad(x)))],
  ["tan", unary((x) => Math.tan(toRad(x)))],
  ["asin", unary((x) => toDeg(Math.asin(x)))],
  ["acos", unary((x) => toDeg(Math.acos(x)))],
  [
    "atan2",
    {
      min: 2,
      max: 2,
      apply: (args) => toDeg(Math.atan2(args[0] ?? Number.NaN, args[1] ?? Number.NaN)),
    },
  ],
  ["rad", unary(toRad)],
  ["deg", unary(toDeg)],
]);
