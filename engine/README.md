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
  ignored), `imports` (`{ local name: "<part>.<value>" }`, see Imports below), `parameters`
  (`{ name: default number }`), `formulas` (`{ name: formula }`), `points`, `curves` and `pieces`
  (arrays in declaration order). Unknown fields are rejected, and formula
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
  `MAX_OUTLINE_ENTRIES` (1 000) per outline and per notch list, else `invalid_definition` at that
  path, and at most `MAX_SECTION_ENTRIES` outline entries and notches across all pieces, else
  `invalid_definition` at `/pieces`;
  formulas keep their own limits (see Formulas). Storage limits are up to the app (ADR 0006).
- **Points.** `name`, `op`, the op's fields and an optional `user_offset: { dx, dy }`. Name fields
  hold point names; formula fields hold formulas (ADR 0003) that may also call the geometry
  functions below. Lengths are mm. The field layout of every op is in
  `src/geometry/point_ops.json`, which the app also reads at compile time (ADR 0008).

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
- **Markings** (ADR 0004 decision 19): an outline entry may have `"fold": true` (a boolean,
  normalised to `fold: false` when absent): the edge lies on a fold of the fabric. A piece may
  have `"cut": n`, an integer from 1 to `MAX_CUT` (100): how many times it is cut (left absent
  when the definition does not say). Anything else is `invalid_definition` at the field's path.
  The computed piece has `folds`, the curve names of its fold entries in outline order (`[]`
  without folds). Fold curves are not checked to be lines; the blocks only mark lines.
- **Notches** (ADR 0004 decision 17) are an optional piece field:
  `"notches": [{ "curve": "<outline curve>", "distance": "<formula>", "marks": 1 | 2 }]`. A notch
  lies `distance` mm along the outline, walking forward in outline order from the start of `curve`
  and on into the following curves, cyclically. A distance exactly at a junction belongs to the
  following curve, and curves of zero length are skipped. `marks` defaults to 1; 2 is the
  conventional double (back) notch. The computed piece has `notches: [{ point, marks: [{ from, to
  }] }]` (always present, `[]` without notches): each mark is `NOTCH_LENGTH` (6 mm) long from the
  outline into the piece (inside follows from the outline's orientation), and a double notch has
  two marks `NOTCH_PAIR_SPACING` (4 mm) apart along the outline, centred on the point. A `curve`
  that is not in the outline is `invalid_notch` (field `notches/i/curve`) for every profile; a
  distance that is not finite or outside `[0, outline length)` is `invalid_notch` (field
  `notches/i/distance`). Either fails the piece. The distance formula may use `length(curve)` and
  any value, like other formula fields.
- **Imports** (ADR 0007) are values taken from another part of the same project:
  `"imports": { "back_armhole_length": "bodice.back_armhole_length" }`. The reference is
  `<part>.<value>`, two identifiers (else `invalid_definition` at `/imports/<name>`). The local
  name is a value in the definition's namespace, like a measurement, and is read from
  `input.imports` (`evaluatePattern(definition, { measurements, imports })`); `evaluateProject`
  fills it from the other part's result `values`. A missing one is `missing_import` (with the
  `reference`), a non-finite one `invalid_value` (`source: "import"`); dependants get
  `failed_dependency`. Formulas stay unchanged: there are no dotted names in them.
- **Geometry functions** in formulas: `distance(A, B)` (mm), `angle(A, B)` (degrees; coincident
  points give `invalid_result`) and `length(curve)` (mm). They take bare names and see final
  positions, user offsets included. They only see the same definition: to use e.g. an armhole
  length in another part of a project, the other part exposes it as a formula and this one
  declares it under `imports` (see Projects). Order follows dependencies, not declaration order;
  cycles give `circular_dependency`, dependants `failed_dependency` (as in Formulas).
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
  `outline/2/curve`, `notches/0/distance`) and `span` into that field. Kinds are those of Formulas
  plus `invalid_definition`, `unsupported_version`, `missing_measurement`, `missing_import`,
  `unknown_parameter`, `wrong_reference_kind`, `degenerate_geometry`, `no_intersection`,
  `open_outline` and `invalid_notch`. Coincident
  points are reported where they are used: in `angle(A, B)` inside a formula they are
  `invalid_result` on the span of the call (like any function without a finite result); in a point
  operation that needs a direction they are `degenerate_geometry` with the operation's `field`.
  Errors are sorted by declaration order (measurements, imports, parameters, formulas, points,
  curves, pieces), with `unknown_parameter` for undeclared overrides last; an override never fails the
  element that has its name.
- **SVG.** `curvePathData(curve)` and `piecePathData(piece)` return path `d` strings (`M`, `L`, `C`,
  `Z`, single spaces, numbers rounded to 0.01 mm, no `-0`) in mm user units.
  `cuttingLinePathData(points)` does the same for a cutting line (`M x y L ... Z`, `""` for fewer
  than two points). The caller chooses the
  `viewBox` and draws the grainline from `piece.grainline`. `formatNumber(value)` is the number
  formatting they use. Hand-built input never makes them throw: curves of an unknown type are
  skipped (or give `""`), and non-finite numbers are written as `0`.
  `patternBounds(pattern, lines?)` returns `{ minX, minY, maxX, maxY }` over every outline curve's
  end and control points, the grainline points and every point of `lines` (such as the pieces'
  cutting lines; optional), null when there is no point or no coordinate is finite (non-finite
  numbers skipped; the result type `Bounds` is exported), so a caller can fit the `viewBox`
  without doing geometry itself.
- **Labels.** `placeLabel(piece, text, size)` returns `{ x, y, size, clearance }`: the centre
  (for `text-anchor="middle"` and `dominant-baseline="middle"`) and font size (mm) at which the
  estimated text box lies inside the piece, farthest from the outline (darts included), the
  grainline and its arrowheads and the notch marks, shrinking the size down to 40 % for a narrow piece; `null` when
  nothing fits (a sliver, or a degenerate outline), and the caller places the label itself.
  Views draw the grainline arrowheads `GRAINLINE_ARROW_SIZE` (8 mm) long and wide, tip on the end
  point, as placement assumes. The text may have several lines, split on `"\n"` (name, then the
  cutting instruction): the box is as wide as the longest line, and each further line adds
  `LABEL_LINE_HEIGHT` (1.2) times the size to its height, so a view spaces its lines by that. It
  costs about 7 to 14 ms per bodice piece, so a view should not call it on every pointer move
  (`engine/src/geometry/label.ts`).

## Seam allowance

`cuttingLine(piece, allowances)` (in `src/geometry/seam-allowance.ts`) returns the cutting line of a
computed piece: its outline offset outwards. Reasoning and rejected alternatives:
`docs/adr/0009-seam-allowance.md`.

```ts
cuttingLine(piece, { default: 10, edges: { b_hem: 40, b_cb: 0 } })
// { ok: true, points: Point[] } or { ok: false, errors }
```

- **Input.** `allowances.default` applies to every outline edge not listed in `edges`, which is
  keyed by curve name. Values are mm, finite, `0` to `MAX_SEAM_ALLOWANCE` (100). `0` puts the line
  on the edge (a fold). Names not in the piece are ignored. Only own properties are read (an
  inherited `default` or `edges` counts as missing). Every invalid value is its own
  `invalid_seam_allowance` error (`edge` names the curve; none for the default) and no line is
  returned. Allowances are not part of the pattern definition; the caller stores them.
- **Result.** `points` is a closed, simple polygon in mm (SVG coordinates, last point not
  repeated), in the same rotational direction as the outline, starting at the leftmost point, with
  every outline vertex inside or on it. It is a polyline within about 0.02 mm of the true offset.
  `cuttingLinePathData(points)` gives its SVG path data. A caller that fits a `viewBox` must include
  the cutting line: pass the lines to `patternBounds(pattern, lines)`.
- **A project's allowances** (ADR 0011). `pieceSeamAllowances(piece, default, edges?)` builds the
  `allowances` for one piece from a project's default and the part's own values by curve name:
  fold edges (`piece.folds`) get 0 unless `edges` has a value for them, and the default never
  applies to a fold. `DEFAULT_SEAM_ALLOWANCE` (10 mm) is a new project's default.
  `cuttingLineNotches(piece.notches, points)` moves every notch mark along its own line out to the
  cutting line, keeping `NOTCH_LENGTH` and pointing inward (unchanged at 0 or where its ray misses
  the line), in the same order.
- **Corners.** Convex corners are mitered, clipped at `MITER_LIMIT` (4) times the larger
  allowance. A corner that turns by less than 90 degrees and would exceed the limit (very
  different allowances on nearly parallel edges, such as 40 and 10 mm below about 11 degrees) is a
  straight step between the two offset ends instead, keeping at least the smaller allowance;
  concave corners are the intersection of the offset edges; smooth joins have no
  corner (a straight step when the allowances differ). Next to a curve that curls away sharply, a
  convex corner is round instead of mitered. Tight concave curves and allowances wider than a
  narrow part never make the line loop or cross itself. If that construction fails its checks, a
  conservative one (all convex corners round, darts as ordinary edges) is used and the result lists
  `safe_construction`.
- **Darts.** A dart is two straight, equal-length legs (within `max(1 mm, 2 %)`; unequal legs are
  matched at their top ends) at a concave apex with a wedge of at most 60 degrees. Its cut edge is
  the neighbouring seams' cutting line with the dart closed and pressed toward the seam before it
  (fixed direction), then unfolded (the dart peak); the legs are not on the cutting line. Two
  darts with one seam between them both get a peak, until that seam is too short. A bend of an
  untrued waist within `DART_BEND_SNAP` (0.25) times the allowance of the fold is treated as on the
  fold. Darts with curved or clearly unequal legs are not detected and get an ordinary concave
  corner.
- **Approximations.** The ok result has an optional `approximations: CuttingLineApproximation[]`,
  present only when non-empty: `{ kind: "safe_construction" }` (the conservative construction was
  used) and `{ kind: "dart_without_peak", legs: [i, j] }` (a detected dart cut as ordinary edges,
  with a notch; `legs` index the piece's own `outline`).
- **Errors** are values, never thrown. `invalid_seam_allowance`: one per invalid value, at most
  `MAX_ALLOWANCE_ERRORS` (100), a map of more than `MAX_SECTION_ENTRIES` edges is one error, names
  are cut to 80 characters in messages (`edge` keeps the full name); render messages as text, the
  names are user-controlled. They come before geometry errors. `degenerate_geometry`: empty or
  zero-area outline, non-finite coordinates, a self-intersecting outline (refused at every
  allowance), or a piece over a work limit ("too complex"): `MAX_OUTLINE_ENTRIES` (1000),
  `MAX_CUTTING_LINE_SEGMENTS` (20 000), `MAX_RAW_LINE_POINTS` (50 000), `MAX_SWEEP_PAIRS` and
  `MAX_CROSSINGS`.
- **Reach.** The line lies at most `hypot(MITER_LIMIT * a, a)`, about 4.12 times the largest
  allowance `a`, from the outline.
- **Limitations.** The back neckline of the bodice has a radius under 4 mm at the shoulder, so its
  cutting line has a concave kink there (true offset geometry; a bodice block follow-up). Two
  darts a few mm apart at 50 to 100 mm allowance can give a line that touches the outline in one
  direction.
- **Modules.** `offset.ts`, `joins.ts`, `boundary.ts`, `darts.ts`, `seam-allowance.ts`.
- **Cost.** About 0.1 ms per skirt piece and 0.2 to 0.25 ms per bodice piece (Bun in Docker on a
  laptop), twice that with the safe fallback; the worst hostile outlines at the entry limit take
  at most about 0.2 s. A view that computes it on every update (the editor's drag) caches it by
  outline and allowances (ADR 0011 decision 8).
## Projects

A pattern project has one or more parts, each a pattern definition with a name (ADR 0007): the
block it was created from (say `bodice`) and blocks added to it (say `straight_sleeve`). In
`src/geometry/project.ts`:

- `compileProject(parts)` takes `[{ name, definition }]` (untrusted), compiles every part once and
  returns `{ evaluate(input) }`; `evaluateProject(parts, input)` is the same in one call. The input
  is `{ measurements, parameters?: { [part name]: overrides } }`: one profile for all parts,
  parameter overrides per part (overrides for names that are not parts are ignored). The optional
  second argument `{ offsets?: { [part name]: { [point]: offset | null } } }` replaces user
  offsets of those parts for one evaluation (each part's `EvaluateOptions.offsets`), as the editor
  does for the point being dragged (ADR 0008); parts that import from a moved part see the change.
- Parts are evaluated in the order their `imports` need (a part importing from another comes after
  it), and each import is fed from the source part's result `values`. Parts in a cycle (a part
  importing from itself included) come last, in the given order. An import whose part is missing,
  whose value the part's result lacks or whose part has any error stays unresolved, so the
  importing part reports `missing_import` on it: a drawing or an error, never a wrong drawing.
- The result is `{ ok, parts: { [name]: PatternResult }, errors }` with the parts in the given
  order; `ok` is true when there are no project errors and every part is ok. `parts` that is not
  an array is one `invalid_project` error; an entry that is not an object with a string `name` is
  `invalid_project` with its `index`, a repeated name `duplicate_part`; such entries are skipped.
  A part with an invalid definition is in `parts` with its errors. Never throws.
- `layoutParts(bounds, gap = PART_GAP)` places parts side by side for drawing: given each part's
  `patternBounds` (or `null`), it returns `{ offsets: [{ dx, dy }], bounds }`, each part `gap`
  (`PART_GAP`, 50 mm) right of the previous ones with its top level with the first part's, and the
  union box after moving (for the `viewBox`). A part without bounds gets `{ dx: 0, dy: 0 }`.
- `layoutPieces(bounds, gap = PIECE_GAP)` moves the pieces of one part apart (ADR 0011): given
  each piece's `patternBounds` with its cutting line (or `null`), it returns the same
  `{ offsets, bounds }`. Taken by left edge, each piece moves right just far enough to lie `gap`
  (`PIECE_GAP`, 20 mm) right of every earlier piece whose box, widened by `gap`, shares rows with
  its own, so every two pieces end up at least `gap` apart in one direction; pieces with room
  enough keep `{ dx: 0, dy: 0 }`. Its `bounds` is the part's box for `layoutParts`.
- `pointPieces(pattern)` gives, by point name, the piece a view draws each point with: the first
  piece whose outline or grainline uses it (by object identity within the result), else the piece
  with the nearest outline box. `shiftCurve(curve, dx, dy)` moves a computed curve, e.g. to hit-test
  a piece where it is drawn.

The project page evaluates all parts in one call, so a redraw (a profile switch, later the
editor's drag) recomputes the sleeve with the bodice.

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
  fitting skirt block. The constants are our own starting values, set and pinned by the engine tests, to be adjusted
  after test fitting (a toile/provsömnad). The waist and hip seam
  lengths equal measurement plus ease by construction (tested within 1 mm). It uses no
  angle-dependent op, so it does not depend on the angle convention.
- **`bodice.json`** ("Liv"): `back` (shoulder dart, waist dart) and `front` (bust dart in the
  shoulder, waist dart). Measurements `bust`, `waist`, `neck`, `shoulder_width`, `back_width`,
  `chest_width`, `back_length`, `armhole_depth`, `bust_height`, `bust_distance`.
  Parameters: `ease_bust` (80 mm), `ease_waist` (40 mm), `ease_armhole_depth` (10 mm) and the draft
  constants `ease_back_width`, `side_shift`, `back_neck_rise`, `front_neck_extra`,
  `back_shoulder_drop`, `front_shoulder_drop`, `back_shoulder_dart`, `back_shoulder_dart_length`,
  `back_waist_dart_gap`, `front_waist_dart_gap`, `bust_dart_rate` (0.12 degrees per mm),
  `bust_dart_offset` (50 mm) and `max_bust_dart_angle` (20 degrees). The `source` names Aldrich,
  the close fitting bodice block, and its deviations. Aldrich takes the bust dart from a size chart; here the
  bust dart angle is derived and follows from the bust excess `bust / 2 - chest_width` (value `bust_excess`):
  `bust_dart_rate` degrees per mm above `bust_dart_offset`, at least 0 and at most
  `max_bust_dart_angle` (value `bust_dart_angle`). The bust point lies `bust_height` from the
  front neck point. The dart is a rotation about it, and the front neck point is placed so that
  the front shoulder point (dart open) lies level with the back one. With no dart the front neck
  point therefore lies above the back one by `front_shoulder_drop - back_shoulder_drop` (level
  with it for the equal default drops). The dart opens in the shoulder, so its neck side rises
  further by `r * (sin(phi - bust_dart_angle) - sin(phi))`, where `r` and `phi` are the distance
  and direction from the bust point to the closed front shoulder point; the rise grows with the
  dart (tested: about 15, 27 and 45 mm in the test figures below). The defaults are calibrated
  so that the size 12 test set and a larger set draft a front length (neck point, bust point,
  waist) within 2 mm of their measured `front_length`. The block itself does not use
  `front_length`. The dart width at the shoulder changes by under 0.8 mm per mm of
  `chest_width`, under 0.4 mm per mm of `bust` and under 0.5 mm per mm of `bust_height`
  (tested). Test figures: about
  34 mm (size 12), 61 mm (bust 1040 mm) and 100 mm (bust 1200 mm, chest width 390 mm). The cap
  only guards against implausible input such as a chest width measured far too narrow. The
  constants and ease are our own starting values, set and pinned by the engine tests, to be
  adjusted after test fitting (a toile/provsömnad). The `back_width` is measured at
  underarm level, and the block draws it as a vertical line from there up to half the armhole
  depth. Each armhole is two cubics, from the shoulder point through the back width point
  (front: the chest point) to the side point. The curve leaves the shoulder seam at a right
  angle and reaches the side point horizontally. At the width or chest point both cubics share
  the direction that makes their curvature about equal there (Hobby's mock curvature for three
  points with given end directions; values `b_arm_width_angle` and `f_arm_chest_angle`), so the
  curve need not be vertical at that point. In travel order (back: shoulder, width point, side
  point; front: side point, chest point, shoulder) with start direction `a`, end direction `b`,
  chord directions `c1` and `c2` and chord lengths `d1` and `d2`, that direction is
  `w = (d2 * (3 * c1 - a) + d1 * (3 * c2 - b)) / (2 * (d1 + d2))`: the linearised curvature at
  the end of the first cubic equals the one at the start of the second. For the back
  (`b_arm_width_balance`) `a` is the shoulder direction and `b` is 0 degrees, so the second term
  reads `3 * d1 * c2`; for the front (`f_arm_chest_balance`) `a` is 360 degrees and `b` is the
  shoulder direction. Both side directions point right. The formula is linear in the angles, so
  all of them must lie in one window without a wrap: `angle()` returns `[0, 360)`, the back
  chords point down (between 0 and 180 degrees) and the front chords up (between 180 and 360),
  so the side direction is written as 0 for the back and as 360 for the front. For the same
  reason the shoulder direction is the upper chord plus the turn from it to the right angle on
  the shoulder seam, taken between -180 and 180 degrees (`atan2(sin(t), cos(t))`, values
  `b_arm_shoulder_turn` and `f_arm_shoulder_turn`): a shoulder point above the neck point, whose
  seam direction wraps past 360 degrees, still gives a direction next to the chord. Above the
  width or chest point the armhole passes less than 1 mm inside the vertical back width or
  chest line in sets A, B and large (tested: under 3 mm), and up to about 4 mm (front) and 6 mm
  (back, whose shoulder point already lies inside the back width line) in the low-bust set
  (tested: under 7 mm). Each cubic gets the handles of a circular arc with the same turn,
  shortened where needed to the intersection of its two end tangents, so the control polygon is
  convex and the curve turns one way only. All directions keep at least `armhole_turn_margin`
  (5 degrees) from the chords between the three points; the right angle at the shoulder gives
  way only where the chord to the width or chest point comes closer to it than that. So a width
  point straight below the shoulder point or outside it still gives one smooth armhole (tested
  without a turn the other way for the test figures, back widths 300 to 400 mm and chest widths
  280 to 400 mm, and with either shoulder point raised by 60 mm). A back width point outside the line from the shoulder
  point to the side point (size 12: a `back_width` above about 415 mm) leaves no such curve and
  the armhole turns the other way near it. The block does not correct that: it points to a
  measuring error. The front armhole is about 10 to 17 mm longer than the back one in the test
  figures (shape of the front armhole curve). By
  construction (tested within 2 mm) the bust line through the underarm points, net of darts,
  equals `bust` + `ease_bust`, the waist seam segments equal `waist` + `ease_waist`, and the
  front and back shoulder seams (dart closed) are equal. The back armhole has a double notch at
  the back width point and the front armhole a single notch at the chest point, where the sleeve
  is matched. The bodice exposes five `values` keys (mm) for other blocks: `armhole_length`,
  `back_armhole_length`, `front_armhole_length`, and `back_armhole_to_notch` and
  `front_armhole_to_notch`, the arc lengths from the side points to the notches (the lower
  armhole curves; about 139 and 137 mm in the size 12 test set). The sleeve imports four of them.
  The five names are a stable interface: renaming one requires migrating the block copies stored
  in pattern projects (ADR 0006, ADR 0007); a test pins them. It uses
  angle-dependent ops (`along_angle`, `perpendicular`, `angle()`), so it relies on the confirmed
  angle convention (ADR 0004 decision 6). Implausible profiles (e.g. a `bust_height` shorter than
  the sideways distance from the neck point to the bust point) make the engine return errors,
  shown as the hook's generic error.
- **`straight_sleeve.json`** ("Rak ärm"): a one-piece sleeve, piece `sleeve`, added to a bodice
  project (it is not a base block: its `imports` need the bodice). Measurements `upper_arm`,
  `arm_length`, `wrist`; imports `back_armhole_length`, `front_armhole_length`,
  `back_armhole_to_notch` and `front_armhole_to_notch` from part `bodice`. Parameters:
  `ease_upper_arm` (50 mm), `ease_wrist` (80 mm), `length_adjustment` (0 mm), `cap_ease` (30 mm)
  and the shape constants `cap_convex_share` (0.6) and `cap_inflection_tilt` (15 degrees). The
  `source` names Aldrich, the one-piece sleeve block, and the deviations; the ease and constants
  are our own starting values, set and pinned by the engine tests, to be adjusted after test
  fitting (a toile/provsömnad).
  The crown is at the origin; the bicep line `upper_arm + ease_upper_arm` wide lies `cap_height`
  below it, and the underarm seams taper straight to a hem `wrist + ease_wrist` wide, centred under
  the bicep line, `arm_length + length_adjustment` below the crown; the grainline runs down through
  the crown. Each cap half runs diagonally from the crown (horizontal) to its underarm point
  (horizontal): a convex circular arc turning `t`, a straight piece of length `s` sloping down at
  `t`, and a concave circular arc turning back by `t`. The arcs' radii add up to `R`, split
  `cap_convex_share` (from the crown) to the rest. For a half of width `w` and height `h`, with the
  guide line from the crown to the underarm point at `a = atan(h / w)`, the inflection tangent is
  `t = min(a + min(a, cap_inflection_tilt), 90)`: `cap_inflection_tilt` steeper than the guide line,
  so the convex crown rises above the guide line and the concave part hollows below it, the straight
  piece crossing it. Then `R * sin(t) + s * cos(t) = w` and `R * (1 - cos(t)) + s * sin(t) = h` give
  `R = (w sin t - h cos t) / (1 - cos t)` and `s = h / tan(t / 2) - w`, and the half's length is
  `R * t + s` (`t` in radians), whatever the convex share. `t` lies between `a` and `2a`, so `R` and
  `s` are never negative; where the tilt reaches the guide angle (a very wide sleeve or a large
  tilt) `t = 2a`, `s = 0` and the half is two arcs; `t` never exceeds 90 degrees, so the cap never
  overhangs. The length's derivative with respect to `t` is zero when `s = 0`, so the length is
  smooth across that switch. The Newton solve below uses the analytic derivative in `h` (the width
  derivative follows from the length being homogeneous of degree 1); its term for the turn's change
  with `h` is multiplied by `(90 - t) / max(90 - t, 0.000001)`, which is 0 at the 90 degree cap,
  where `t` no longer changes with `h`. Out-of-range shape constants (a share outside 0 to 1, a
  tilt of 0 or less) make the guard value `cap_constants_ok` fail, and a solve that leaves either
  half more than 0.1 mm from its target (in closed form, `back_cap_solved` and
  `front_cap_solved`), a half width of 0 or less, or a cap height of 0 or less makes `cap_fit_ok`
  fail; every cap arc depends on both, so an implausible input (for example a far too narrow
  `upper_arm`, such as 60 mm on armhole halves of 220 and 240 mm) gives `invalid_result` instead
  of a looped cap or one of the wrong length. With a non-default, larger `cap_inflection_tilt` (for
  example 30) some tall caps can trip this fit guard and give an error rather than a drawing. The cap height and the crown
  shift `cap_split` (front half `bicep / 2 + cap_split` wide, back `bicep / 2 - cap_split`) are
  solved so that each half equals its armhole half plus `cap_ease / 2`: a chord estimate, then
  Newton steps on the height, the shift and the height again, unrolled as formulas (values `cap_h_0`
  to `cap_h_4`, `cap_split_0`, `cap_split_1`; ADR 0007 decision 7). The arcs are cubics with the
  circular-arc handles. Tested: the cap halves are within 0.05 mm of their targets for the four test
  figures with upper arms 240 to 380 mm (under 0.01 mm; under 0.045 mm with `cap_inflection_tilt`
  90, two arcs or the 90 degree cap, where the cubic stands in for a 90 degree arc), so the cap
  equals the bodice armhole plus `cap_ease` (tested within 2 mm, under 0.01 mm), also after a
  deeper armhole or a user offset on the back width point. The cap height changes by about 0.6 to 0.7 mm per mm of armhole length
  (tested under 1) and -0.36 to -0.53 mm per mm of `upper_arm` (tested under 0.75 in size);
  `cap_convex_share` 0.5 or 0.7 leaves the cap length unchanged (tested within 0.2 mm). Shape,
  tested for the four test figures with upper arms within 20 mm of theirs: the inflection tangent
  lies between 35 and 70 degrees (about 52 to 66 with their own upper arms), the convex crown rises
  10 to 35 mm above the guide line and the hollow below it is shallower. Size 12 test figure: cap
  height about 174 mm, inflection about 64 (back) and 59 (front) degrees, crown shifted 13 mm toward
  the back. Values `back_cap_length`, `front_cap_length` and `cap_length` are the drawn cap.
  Notches: a double one on the back half and a single one on the front half, at the same arc
  distance from the underarm points as the bodice notches from the side points (tested within 0.5
  mm), and one at the crown, matching the shoulder seam; so all the cap ease lies between the
  notches. A sleeve wider than its armhole halves (an implausible `upper_arm`) gives
  `invalid_result` on `cap_h_0`, shown as the hook's generic error.

## Editor helpers

`src/editor/` holds the pure logic behind the project page editor (ADR 0008). All of it works on the
raw definition JSON as stored, so a save differs from the stored definition only where the user
edited.

- `setUserOffset(definition, point, offset | null)`: replaces one point's `user_offset` (rounded to
  0.1 mm with `roundOffset`; `null` removes it). Other points keep their identity.
- `getPoint(definition, name)`: the raw point called `name`, or `undefined`.
- `setPointFormula(definition, point, field, formula)`: replaces one formula field; anything else is
  returned unchanged.
- `pointFields(point)`, `controlPoints(definition)`: the op's fields for a panel, and the `c1`/`c2`
  names of cubic curves.
- `tryPattern(definition, input)`: compile and evaluate; `ok` only if the result is `ok`, else the
  errors. `errorsFor(errors, point, field?)` picks the ones for a point.
- `pickPoint(points, at, radius, prefer?)`: nearest point within a radius, ties to `prefer`.
- History: `createHistory`, `push`, `undo`, `redo`, `canUndo`, `canRedo`: immutable undo/redo over
  `{ definition, parameters }`, bounded to `HISTORY_LIMIT` (100) steps by default.
- Units: `toDisplay`, `fromDisplay`, `formatDisplay` convert parameter values between stored units
  and the units shown (mm to cm, degrees per mm to per cm). `MAX_PARAMETER` (1 000 000) is the
  largest absolute parameter value; the app's bound is pinned to it by a test.
- Seam allowance edges (`edges.ts`, ADR 0011): `pickEdge(pieces, at, radius, prefer?)` gives the
  nearest outline edge `{ piece, curve }` within a radius (cubics measured along the curve), ties
  to the curve `prefer`. A project's stored allowances are `ProjectSeamAllowances`, `{ default,
  edges: { part: { curve: mm } } }`: `readSeamAllowances(raw)` reads them tolerantly (an invalid
  default becomes `DEFAULT_SEAM_ALLOWANCE`, invalid entries are dropped, only own keys),
  `setDefaultAllowance` and `setEdgeAllowance(a, part, curve, mm | null)` edit them (`null`
  removes a value; the same object when nothing changes), and `edgeAllowance(a, part, piece,
  curve)` gives `{ value, source: "edge" | "fold" | "default" }` for the panel.
