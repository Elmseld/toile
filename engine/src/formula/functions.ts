// The functions a formula may call. Angles are in degrees: sin/cos/tan take degrees and
// asin/acos/atan2 return degrees (ADR 0003). rad() and deg() convert for other maths.

/**
 * Arity (`max: null` means unbounded) and implementation of a formula function.
 *
 * By default a function takes numbers: each argument is an expression, evaluated before `apply`.
 * With `takes: "names"` every argument must be a bare name, which is passed to `apply` unevaluated
 * so the function can resolve it itself (for example a point in `distance(A, B)`). Such names are
 * still listed by `references`, so they count as dependencies. A non-finite result from `apply`,
 * or an exception thrown by it, is an `invalid_result` error naming the function, on the span of
 * the call; the exception itself is not reported. `apply` should still return `NaN` rather than
 * throw for arguments it cannot handle.
 *
 * Callers can pass their own table (usually a copy of `FUNCTIONS` plus their own entries, e.g.
 * `new Map([...FUNCTIONS, ["distance", spec]])`) to `parseFormula` and `evaluateExpression`.
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

// One multiplication by a precomputed ratio: multiplying by π or 180 first would overflow to
// Infinity for huge inputs whose converted value is still representable.
const RAD_PER_DEG = Math.PI / 180;
const DEG_PER_RAD = 180 / Math.PI;
const toRad = (degrees: number): number => degrees * RAD_PER_DEG;
const toDeg = (radians: number): number => radians * DEG_PER_RAD;

// Callers check arity before `apply`, so `args[i] ?? NaN` is only there for the type checker.
const unary = (fn: (x: number) => number): FunctionSpec => ({
  min: 1,
  max: 1,
  apply: (args) => fn(args[0] ?? Number.NaN),
});

/**
 * Wraps `entries` in a frozen table that has only the read side of `Map` (`get`, `has`, `size`,
 * `keys`, `values`, `entries`, `forEach` and iteration). The specs are frozen too, so a shared
 * table such as `FUNCTIONS` cannot be changed by one caller for everyone else. The result still
 * iterates like a `Map`, so `new Map([...table, [name, spec]])` builds an extended table.
 */
function readonlyTable(entries: Iterable<readonly [string, FunctionSpec]>): FunctionTable {
  const map = new Map<string, FunctionSpec>();
  for (const [name, spec] of entries) map.set(name, Object.freeze({ ...spec }));
  const table: FunctionTable = {
    get size() {
      return map.size;
    },
    get: (name) => map.get(name),
    has: (name) => map.has(name),
    keys: () => map.keys(),
    values: () => map.values(),
    entries: () => map.entries(),
    forEach: (callback, thisArg) => {
      map.forEach((spec, name) => callback.call(thisArg, spec, name, table));
    },
    [Symbol.iterator]: () => map.entries(),
  };
  return Object.freeze(table);
}

/**
 * The built-in function table, used when no other table is given. It is read-only: extend it by
 * copying, e.g. `new Map([...FUNCTIONS, ["distance", spec]])`.
 */
export const FUNCTIONS: FunctionTable = readonlyTable([
  ["sqrt", unary(Math.sqrt)],
  ["abs", unary(Math.abs)],
  // A fold rather than `Math.min(...args)`: spreading a very long argument list overflows the stack.
  ["min", { min: 1, max: null, apply: (args) => args.reduce((a, b) => Math.min(a, b), Infinity) }],
  ["max", { min: 1, max: null, apply: (args) => args.reduce((a, b) => Math.max(a, b), -Infinity) }],
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
