// The functions a formula may call. Angles are in degrees: sin/cos/tan take degrees and
// asin/acos/atan2 return degrees (ADR 0003). rad() and deg() convert for other maths.

/**
 * Arity (`max: null` means unbounded) and implementation of a formula function.
 *
 * By default a function takes numbers: each argument is an expression, evaluated before `apply`.
 * With `takes: "names"` every argument must be a bare name, which is passed to `apply` unevaluated
 * so the function can resolve it itself (for example a point in `distance(A, B)`). Such names are
 * still listed by `references`, so they count as dependencies. A non-finite result from `apply`
 * is an `invalid_result` error.
 *
 * Callers can pass their own table (usually `FUNCTIONS` plus their own entries) to `parseFormula`
 * and `evaluateExpression`.
 */
export type FunctionSpec =
  | {
      min: number;
      max: number | null;
      takes?: "numbers";
      apply: (args: readonly number[]) => number;
    }
  | {
      min: number;
      max: number | null;
      takes: "names";
      apply: (names: readonly string[]) => number;
    };

/** A function table, keyed by name. Use a `Map` so prototype members are never reachable. */
export type FunctionTable = ReadonlyMap<string, FunctionSpec>;

const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
const toDeg = (radians: number): number => (radians * 180) / Math.PI;

// Callers check arity before `apply`, so `args[i] ?? NaN` is only there for the type checker.
const unary = (fn: (x: number) => number): FunctionSpec => ({
  min: 1,
  max: 1,
  apply: (args) => fn(args[0] ?? Number.NaN),
});

/** The built-in function table, used when no other table is given. */
export const FUNCTIONS: FunctionTable = new Map<string, FunctionSpec>([
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
