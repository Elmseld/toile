# @toile/engine

The pattern engine: pure TypeScript that turns measurements and a pattern definition into geometry.
It has no UI and no I/O, so the editor, the PDF export and the server all use the same code.

```bash
bun install
bun test
bun run typecheck
```

## Measurements
`MEASUREMENT_KEYS` (readonly array, display order) and `isMeasurementKey(name)` come from
`src/measurements.json`, the single list of body measurement keys. The Phoenix app reads the same
file at compile time for its measurement profiles (`docs/adr/0005-measurement-keys.md`). Blocks
should use these keys in their `measurements` list and formulas. The engine does not reject other
names. Renaming a key is a breaking change for stored data.

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
(see Compiling below). The browser editor hook runs it on the client (0005). See
`docs/adr/0004-pattern-definition-format.md` for the reasoning.

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
  fields must be strings (`"distance": "50"`, not `50`). A point or curve with a missing or
  unknown `op` or `type` still has its fields checked: those no op or type knows are reported too.
- **Versions.** The version is bumped only when the meaning of existing fields changes or a field
  becomes required or changes shape, with an explicit migration in the engine. New optional
  fields, ops and curve types keep version 1; an older engine rejects definitions that use them as
  `invalid_definition` (unknown field) instead of misreading them.
- **Validation.** `validateDefinition(value: unknown)` never throws and reports every structural
  problem at once as `invalid_definition` with a JSON-pointer `path` (`/points/3/distnce`), or
  `unsupported_version` (path `/version`) for any version other than `1`. `evaluatePattern` runs
  it first.
- **Limits.** At most `MAX_SECTION_ENTRIES` (20 000) entries per section and
  `MAX_OUTLINE_ENTRIES` (1 000) per outline, else `invalid_definition` at that path, and at most
  `MAX_SECTION_ENTRIES` outline entries across all pieces, else `invalid_definition` at `/pieces`;
  formulas keep their own limits (see Formulas). Storage limits are up to the app (ADR 0006).
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
  lines and a line that misses the circle are `no_intersection`. A position, before or after the
  user offset, that is not finite or lies more than `MAX_COORDINATE` (1e7 mm, 10 km) from the
  origin on either axis is `degenerate_geometry` without a `field` (an offset cannot bring an
  out-of-bounds base position back); the bound keeps every length and SVG number finite. Field order
  in the table is the order of the point's dependency edges, which decides the `field` of a
  `failed_dependency`.
- **Angles.** Degrees, 0 = right, 90 = down (clockwise on screen, since y points down),
  normalised to `[0, 360)`. `angle(A, B)`, `along_angle` and `perpendicular` all use this. The
  convention is confirmed (ADR 0004 decision 6, ticket 0005).
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
  positions, user offsets included. They only see the same definition: to use e.g. an armhole
  length in another pattern, the caller evaluates pattern 1, reads `curves.<name>.length` (or a
  formula value) from the result and passes it as a measurement to pattern 2. References between
  patterns are ticket 0007. Order follows dependencies, not declaration order; cycles give
  `circular_dependency`, dependants `failed_dependency` (as in Formulas).
- **User offsets.** `user_offset` is added after the operation and is the point's position
  everywhere downstream (dependent points, curves, `distance`/`angle`, pieces).
- **Result.** `{ ok: true, values, points, basePoints, curves, pieces }` or the same plus
  `errors`. All records hold what computed, in declaration order, even when other parts failed.
  `points` are final positions; `basePoints` are positions before the user offset, for every point
  in `points` and also for a point whose operation computed within bounds but whose offset
  position did not, so an editor turns a pointer position `p` into the offset
  `p - basePoints[name]`. Curves and pieces hold computed points and `length`. Results are
  read-only (typed `Readonly`): within one result the same point and curve objects appear in
  `points`, `basePoints`, `curves` and `pieces`. Results share no objects with each other or with
  a compiled pattern, so a caller that does mutate one (its errors, say) affects nothing else.
- **Compiling.** `compilePattern(definition)` does all the work that depends only on the
  definition once (validation, names and references, parsing, outline closure, dependency order
  and cycles) and returns `{ evaluate(input, options?) }`, which gives exactly what
  `evaluatePattern(definition, input)` gives. Keep it while the definition is unchanged (a drag,
  switching measurement profiles); evaluations share no state or result objects, also when one
  runs inside another (each restores the geometry state it found). `options.offsets`
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
  `patternBounds(pattern)` returns `{ minX, minY, maxX, maxY }` over every outline curve's end and
  control points and the grainline points (null without pieces or when no coordinate is finite, non-finite numbers skipped; the result type
  `Bounds` is exported), so a
  caller can fit the `viewBox` without doing geometry itself.

## Blocks

`engine/blocks/<key>.json` holds the block definitions (version 1 pattern definitions), one file
per block, keyed by file name (`^[a-z][a-z0-9_]*$`). The Phoenix app reads them at compile time
(`Toile.Patterns.Blocks`) and copies one into a pattern project when it is created, so later
changes to a block do not affect existing projects (`docs/adr/0006-pattern-projects-and-blocks.md`).
The engine has no block registry.

- **`straight_skirt.json`** ("Rak kjol"): front and back pieces, each with one waist dart and a
  hip curve. Measurements `waist`, `hip`, `hip_height`, `skirt_length`; parameters `ease_waist`
  (10 mm), `ease_hip` (40 mm), `length_adjustment` (0 mm, added to `skirt_length` in the formula `finished_length`) and the draft
  constants `side_shift`, `side_rise`, `back_dart_length`, `front_dart_length`. The `source` field
  names the method: Winifred Aldrich, *Metric Pattern Cutting for Women's Wear*, 6th ed., the close
  fitting skirt block. The constants are not yet checked against the book. The waist and hip seam
  lengths equal measurement plus ease by construction (tested within 1 mm). It uses no
  angle-dependent op, so it does not depend on the angle convention.
- **`bodice.json`** ("Liv"): `back` (shoulder dart, waist dart) and `front` (bust dart in the
  shoulder, waist dart). Measurements `bust`, `waist`, `neck`, `shoulder_width`, `back_width`,
  `chest_width`, `back_length`, `armhole_depth`, `front_length`, `bust_height`, `bust_distance`.
  Parameters: `ease_bust` (80 mm), `ease_waist` (40 mm), `ease_armhole_depth` (10 mm) and the draft
  constants `ease_back_width`, `side_shift`, `back_neck_rise`, `front_neck_extra`,
  `back_shoulder_drop`, `front_shoulder_drop`, `back_shoulder_dart`, `back_shoulder_dart_length`,
  `back_waist_dart_gap`, `front_waist_dart_gap`, `max_bust_dart_angle` (15 degrees). The `source`
  names Aldrich, the close fitting bodice block, and its deviations: the bust dart follows from
  `front_length`, `bust_height` and `bust_distance` (rotation about the bust point) instead of a
  size-chart value. The constants and ease are not yet checked against the book.
  The bust dart is sensitive to `front_length`: its width at the shoulder grows by about 2 mm per
  mm of `front_length` (tested). The value `bust_dart_balance_angle` is the rotation that would
  bring the front shoulder point level with the back one; `bust_dart_angle` is that, capped at
  `max_bust_dart_angle`. Above the cap the rest of the difference stays in the front, whose
  shoulder point then lies higher than the back one; the seam lengths and the bust and waist
  widths are unaffected, but the front armhole gets deeper and longer than the back one and will
  gape once sewn, which also raises `front_armhole_length` and `armhole_length` (for the large
  set: front shoulder 25 mm higher, shoulder to underarm 265 against 240 mm, front armhole 327
  against back 288 mm). Moving that rest into a second dart is dart manipulation, out of scope
  here. A large test figure (bust 1200 mm, `front_length` 80 mm over
  `back_length`) would otherwise get a dart of about 23 degrees, 120 mm wide on a 135 mm shoulder.
  The dart is zero, without an error, whenever the front neck point lies no higher than the back
  neck point (with the default shoulder drops), e.g. for the size 12 test set when `front_length`
  is at most about 21 mm over `back_length`. By construction (tested within 2 mm) the bust line
  through the underarm points, net of darts, equals `bust` + `ease_bust`, the waist seam
  segments equal `waist` + `ease_waist`, and the front and back shoulder seams (dart closed) are
  equal. The bodice exposes three `values` keys (mm): `armhole_length`, `back_armhole_length` and
  `front_armhole_length`. How the sleeve (0007) consumes them is 0007's decision. The three names
  are a stable interface: renaming one requires migrating the block copies stored in pattern
  projects (ADR 0006); a test pins them. It uses angle-dependent ops
  (`along_angle`, `perpendicular`, `angle()`), so it relies on the confirmed angle convention
  (ADR 0004 decision 6). Implausible profiles (e.g. `front_length <= bust_height`) make the engine
  return errors, shown as the hook's generic error.
