# @toile/engine

The pattern engine: pure TypeScript that turns measurements and a pattern definition into geometry.
It has no UI and no I/O, so the editor, the PDF export and the server all use the same code.

```bash
bun install
bun test
bun run typecheck
```

## Formulas

`evaluateFormulas({ measurements, parameters, formulas })` (in `src/formula/`) evaluates named
formulas such as `waist / 4 + ease_waist` with a custom parser (no `eval`). See
`docs/adr/0003-formula-language.md` for the reasoning.

- **Syntax.** Numbers (`12`, `12.5`), `+ - * /` with usual precedence and left associativity,
  parentheses, unary minus, references by identifier, and function calls. No `.5`, exponents or
  decimal comma.
- **Functions.** `sqrt`, `abs`, `rad`, `deg`, `sin`, `cos`, `tan`, `asin`, `acos` take one argument;
  `min` and `max` take one or more; `atan2(y, x)` takes two. Angles are in degrees (`sin/cos/tan`
  take degrees, `asin/acos/atan2` return degrees); `rad()` and `deg()` convert. Lengths are mm.
- **Namespace.** Measurements, parameters and formulas share one namespace. A name in two sources is
  a `duplicate_name` error. Measurement and parameter values must be finite numbers
  (`invalid_value`); every value is checked, also under an invalid or duplicate name. Formulas may
  reference each other in any declaration order.
- **Result.** `{ ok: true, values }` or `{ ok: false, values, errors }`. `values` holds every valid
  measurement and parameter plus every formula that evaluated, even when others failed.
- **Errors** are values, never thrown. Each has `kind`, `name` and (mostly) a `span` of 0-based
  offsets into the formula source: `syntax`, `unknown_function`, `wrong_argument_count`,
  `invalid_argument`, `unknown_reference`, `division_by_zero`, `invalid_result`,
  `circular_dependency`, `failed_dependency`, `invalid_name`, `duplicate_name`, `invalid_value`.
  `message` is English developer text; build UI text from `kind` and the fields.
- **Cycles.** Each group of mutually dependent formulas gets one `circular_dependency`, whose
  `cycle` is the group's shortest cycle through its first-declared member (e.g.
  `["a", "b", "c", "a"]`). Every other member of the group gets `failed_dependency` (on the next
  member of the cycle when it is on it), as does every formula that depends on a failed name. A
  formula that already has an error (such as an unknown reference) keeps only that one; the cycle
  is then headed by the first-declared member that has not failed.
- **Limits.** Formulas over 10 000 characters or nested deeper than 100 levels are `syntax` errors.
- **Lower level.** `parseFormula(source, options?)`, `references` and
  `evaluateExpression(expr, lookup, options?)` are exported for callers (such as geometry) that
  resolve names themselves. `options.functions` replaces the function table (default `FUNCTIONS`,
  which is read-only: extend a copy, `new Map([...FUNCTIONS, ["distance", spec]])`);
  a `FunctionSpec` with `takes: "names"` receives its arguments as bare names, unevaluated (for
  example `distance(A, B)`). Use the same table for parsing and evaluation. A function that returns
  a non-finite number or throws gives an `invalid_result` error for its call; a `lookup` that
  throws (or returns a non-finite number) gives one on the span of the reference.

## Pattern definitions

`evaluatePattern(definition, { measurements, parameters? })` (in `src/geometry/`) takes a stored
pattern definition (JSON) and a measurement profile and returns computed geometry;
`compilePattern(definition).evaluate(input)` does the same with the definition-only work done once
(see Compiling below). The Phoenix app
does not use it yet (0005). See `docs/adr/0004-pattern-definition-format.md` for the reasoning.

```json
{
  "version": 1,
  "measurements": ["hip"],
  "parameters": { "ease_hip": 10 },
  "formulas": { "width": "hip / 4 + ease_hip" },
  "points": [
    { "name": "A", "op": "start", "x": "0", "y": "0" },
    { "name": "B", "op": "along_angle", "from": "A", "angle": "0", "distance": "width" }
  ],
  "curves": [{ "name": "top", "type": "line", "from": "A", "to": "B" }],
  "pieces": []
}
```

A complete example (a rectangle with a dart, tested against two measurement sets) is
`examples/rectangle-with-dart.json`.

- **Top level.** `version` (required, integer, must be `1`), optional `name` and `source`
  (strings), and optional `measurements` (names the pattern uses; other profile entries are
  ignored), `parameters` (`{ name: default number }`), `formulas` (`{ name: formula }`), `points`,
  `curves` and `pieces` (arrays in declaration order). Unknown fields are rejected, and formula
  fields must be strings (`"distance": "50"`, not `50`).
- **Versions.** The version is bumped only when the meaning of existing fields changes or a field
  becomes required or changes shape, with an explicit migration in the engine. New optional
  fields, ops and curve types keep version 1; an older engine rejects definitions that use them as
  `invalid_definition` (unknown field) instead of misreading them.
- **Validation.** `validateDefinition(value: unknown)` never throws and reports every structural
  problem at once as `invalid_definition` with a JSON-pointer `path` (`/points/3/distnce`), or
  `unsupported_version` (path `/version`) for any version other than `1`. `evaluatePattern` runs
  it first.
- **Points.** `name`, `op`, the op's fields and an optional `user_offset: { dx, dy }`. Name fields
  hold point names; formula fields hold formulas (ADR 0003) that may also call the geometry
  functions below. Lengths are mm.

  | `op` | Fields | Result |
  |------|--------|--------|
  | `start` | `x`, `y` | `(x, y)` |
  | `offset` | `from`, `dx`, `dy` | `from + (dx, dy)` |
  | `along_line` | `from`, `to`, `distance` | Signed `distance` from `from` toward `to` (negative goes away; may pass `to`). |
  | `along_angle` | `from`, `angle`, `distance` | `from + distance * (cos angle, sin angle)` |
  | `perpendicular` | `from`, `to`, `distance` | Signed `distance` from `from` on the perpendicular to `from -> to`; positive is `angle(from, to) + 90` (for a line pointing right, down). |
  | `line_intersection` | `line1`, `line2` (each `[name, name]`) | Intersection of the two infinite lines. |
  | `line_circle_intersection` | `line` `[name, name]`, `center`, `radius`, `which` (`"first"` or `"second"`) | Intersection of the infinite line with the circle; `first` has the smaller parameter along `line[0] -> line[1]` (a tangent gives the same point for both). |
  | `midpoint` | `from`, `to` | `(from + to) / 2` |

  Coincident points where a direction is needed (`along_line`, `perpendicular`, either line of
  an intersection) and a negative radius are `degenerate_geometry` with the `field`; parallel
  lines and a line that misses the circle are `no_intersection`. A final position (user offset
  included) that is not finite or lies more than `MAX_COORDINATE` (1e7 mm, 10 km) from the origin
  on either axis is `degenerate_geometry` without a `field`; the bound keeps every length and SVG
  number finite. Field order in the table is the order of the point's dependency edges, which
  decides the `field` of a `failed_dependency`.
- **Angles.** Degrees, 0 = right, 90 = down (clockwise on screen, since y points down),
  normalised to `[0, 360)`. `angle(A, B)`, `along_angle` and `perpendicular` all use this. The
  convention is to be confirmed before 0005 stores the first block (an open question there).
- **Curves.** `{ name, type: "line", from, to }` or `{ name, type: "cubic", from, c1, c2, to }`;
  every end and control point is a named point. Computed curves carry their `length` (arc length
  of a cubic, within 0.01 mm).
- **Pieces.** `{ name, outline: [{ curve }], grainline: { from, to } }`: each outline entry is an
  object naming one curve (room for per-edge fields in later versions), and the grainline has point
  names. The outline must close by point name (the `to` of each curve is the `from` of the next,
  cyclically), else `open_outline` on the next entry (`field: "outline/i/curve"`). Closure is
  checked before any geometry is computed, so it does not depend on the measurements. Curves are
  traversed in their defined direction.
- **Geometry functions** in formulas: `distance(A, B)` (mm), `angle(A, B)` (degrees; coincident
  points give `invalid_result`) and `length(curve)` (mm). They take bare names and see final
  positions, user offsets included. Order follows dependencies, not declaration order; cycles give
  `circular_dependency`, dependants `failed_dependency` (as in Formulas).
- **User offsets.** `user_offset` is added after the operation and is the point's position
  everywhere downstream (dependent points, curves, `distance`/`angle`, pieces).
- **Result.** `{ ok: true, values, points, basePoints, curves, pieces }` or the same plus
  `errors`. All records hold what computed, in declaration order, even when other parts failed.
  `points` are final positions; `basePoints` are positions before the user offset (for every point
  whose operation computed, also when the offset position did not), so an editor turns a pointer
  position `p` into the offset `p - basePoints[name]`. Curves and pieces hold computed points and
  `length`.
- **Compiling.** `compilePattern(definition)` does all the work that depends only on the
  definition once (validation, names and references, parsing, outline closure, dependency order
  and cycles) and returns `{ evaluate(input, options?) }`, which gives exactly what
  `evaluatePattern(definition, input)` gives. Keep it while the definition is unchanged (a drag,
  switching measurement profiles); evaluations share no state or result objects. `options.offsets`
  (`{ [point]: { dx, dy } | null }`) replaces the definition's `user_offset` of those points for
  one evaluation (`null` removes it; other names are ignored; an entry without numeric `dx`/`dy`
  makes the point `degenerate_geometry`). For a 300-point block a compiled evaluation takes about
  0.4 ms, `evaluatePattern` about 2.5 ms.
- **Errors** are values, never thrown, for any input. Structural errors have `path`; the others
  have `kind`, `name` (the element) and optionally `field` (e.g. `distance`, `line1/0`,
  `outline/2/curve`) and `span` into that field. Kinds are those of Formulas plus
  `invalid_definition`, `unsupported_version`, `missing_measurement`, `unknown_parameter`,
  `wrong_reference_kind`, `degenerate_geometry`, `no_intersection` and `open_outline`. Coincident
  points are reported where they are used: in `angle(A, B)` inside a formula they are
  `invalid_result` on the span of the call (like any function without a finite result); in a point
  operation that needs a direction they are `degenerate_geometry` with the operation's `field`.
  Errors are sorted by declaration order (measurements, parameters, formulas, points, curves,
  pieces), with `unknown_parameter` for undeclared overrides last; an override never fails the
  element that has its name.
- **SVG.** `curvePathData(curve)` and `piecePathData(piece)` return path `d` strings (`M`, `L`, `C`,
  `Z`, single spaces, numbers rounded to 0.01 mm, no `-0`) in mm user units. The caller chooses the
  `viewBox` and draws the grainline from `piece.grainline`. `formatNumber(value)` is the number
  formatting they use. Hand-built input never makes them throw: curves of an unknown type are
  skipped (or give `""`), and non-finite numbers are written as `0`.
