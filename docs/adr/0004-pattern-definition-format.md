# 0004: Pattern definition format

Status: accepted (ticket 0003)

## Context
A pattern is stored as a **pattern definition**: parameters, formulas, points, curves and pattern
pieces. The Phoenix app persists it and the editor (0008) saves it, so it is effectively a schema.
The engine turns a definition plus a measurement profile into geometry on every pointer move during
a drag. The definition and its formulas are untrusted user input. This ADR builds on ADR 0003
(formula language, dependency graph, injectable function table).

## Decision
1. **JSON with an integer `version`, strict.** The top level has `"version": 1`
   (`PATTERN_FORMAT_VERSION`). A missing or non-numeric version is `invalid_definition`; any other
   number is `unsupported_version`. Unknown fields (top level or on an element) are rejected so typos
   such as `distnce` are caught. The version is bumped only for changes in meaning (an existing
   field or op computing something else, such as a new angle convention) or in required shape (a
   field becoming required, renamed or restructured); each such bump comes with an explicit
   migration in the engine (`1 -> 2`), never silent reinterpretation. Additive optional fields and
   new `op`s or curve types do not bump the version and need no migration: every existing
   definition keeps its meaning, and because validation is strict an older engine rejects a
   definition that uses them as `invalid_definition` (unknown field or op) instead of misreading
   it. So version 1 can grow through 0005-0009 without a chain of trivial migrations.
2. **Points are operations.** Each point has a `name`, an `op` and that op's fields. Name fields
   hold a point name; formula fields hold a formula string (ADR 0003). Free coordinates exist only
   as `start` and `user_offset`. Ops: `start`, `offset`, `along_line`, `along_angle`,
   `perpendicular`, `line_intersection`, `line_circle_intersection`, `midpoint`.
3. **Declared `measurements` list.** The definition lists the measurements it uses; only those
   enter the namespace, so a profile can never collide with a point or formula name, and a missing
   one is reported as `missing_measurement`.
4. **One namespace** for measurements, parameters, formulas, points, curves and pieces
   (`duplicate_name` otherwise). A reference of the wrong kind (a measurement as `from`, `length(A)`
   with A a point) is `wrong_reference_kind`.
5. **User offsets propagate.** `user_offset: { dx, dy }` (mm) is added after the operation; the
   offset position is the point's position everywhere downstream (dependent points, curves,
   `distance`/`angle`, pieces), so dependants follow along during a drag. The offset lives in the
   definition because the editor saves the definition.
6. **Angle convention.** Degrees, 0 = right, 90 = down (clockwise on screen, because y points
   down), normalised to `[0, 360)`. This is `atan2(dy, dx)` in SVG coordinates with no sign flip.
   `angle(A, B)`, `along_angle` and `perpendicular` share it, so
   `along_angle(A, angle(A, B), d)` equals `along_line(A, B, d)`. `perpendicular` with a positive
   distance lies at `angle(from, to) + 90`: for a line pointing right, positive is down. Seamly2D
   and Valentina use 90 = up. Confirmed in ticket 0005, before the first block was stored:
   switching now would change the meaning of stored definitions (a version bump and a migration).
   The user interface may present angles converted without changing stored definitions.
7. **Perpendicular op.** A point at a signed distance on the perpendicular erected at `from` on
   `from -> to`. Dropping a foot point onto a line is not added; add an op (no version bump, see
   decision 1) when a block needs it.
8. **Geometry functions via the injectable table** (ADR 0003 decision 8): `distance(A, B)`,
   `angle(A, B)` and `length(curve)` with `takes: "names"`, in a table that reads the points and
   curves of the running evaluation from a state holder when applied (so parsed formulas can be
   reused across evaluations, decision 15). Each evaluation saves the holder's previous state and
   restores it when it ends, so an evaluation nested inside another (not possible today, but
   cheap to rule out) leaves the outer one its own geometry. Not added: `x(A)` / `y(A)`;
   `length` takes one curve (sum with `+`).
9. **One dependency graph.** Formulas, points, curves and pieces are nodes of the same dependency
   graph (`planGraph`/`runGraphPlan`, the split form of `evaluateGraph`, ADR 0003 decision 4):
   ordering by dependency, one `circular_dependency` per cycle, `failed_dependency` for dependants,
   partial results. Pieces are leaves that fail through their curves and grainline points.
10. **Error model.** Errors are values. Structural errors (`invalid_definition`,
    `unsupported_version`) carry a JSON-pointer `path`, are reported all at once and stop evaluation.
    Semantic errors carry `name` (the element), an optional `field` (where inside it) and a `span`
    into that field's string, and evaluation returns whatever still computed.
11. **Outline entries are objects, closed by point name.** A piece outline is an ordered list of
    entries `{ "curve": "name" }`. An object rather than a bare curve name leaves room for per-edge
    data (reversed traversal, seam allowance in 0009, fold lines) as optional fields, without
    changing the shape of stored outlines. The `to` point of each entry's curve must be the `from`
    point of the next, cyclically, else `open_outline` on the next entry (`outline/i/curve`).
    Curves are traversed in their defined direction; v1 has no other entry fields. Closure is
    checked by name rather than by coordinate, before any geometry is evaluated, so validity is
    independent of the measurements: an open outline is reported even when its curves fail to
    compute.
12. **Arc length by fixed composite Gauss-Legendre** (5 points on 16 sub-intervals, raised if
    accuracy requires), within 0.01 mm of a fine polyline reference; lines use `distance`.
    Deterministic and fixed cost on the drag path.
13. **SVG output** is `M/L/C/Z` path data in mm user units, rounded to 0.01 mm with no `-0`. The
    caller chooses the `viewBox`.
14. **No schema file.** The TypeScript validator is the source of truth. How the Phoenix app
    validates stored definitions is decided in ADR 0006 (shape and size only) and 0008 (Elixir
    validates but never computes geometry).
15. **Compile once, evaluate per input.** `compilePattern(definition)` validates, checks names and
    references, parses every formula, checks outline closure and orders the dependency graph
    (cycle errors included) once; its `evaluate(input, { offsets }?)` only reads measurement and
    parameter values, evaluates the parsed formulas and computes the geometry, with `offsets`
    replacing points' `user_offset` for that evaluation. `evaluatePattern(definition, input)` is
    the composition, with identical results. The editor (0008) keeps one compiled pattern during a
    drag, and turns a pointer position into an offset with the pre-offset `basePoints` of the
    result. Measured for a 300-point block: about 0.4 ms per compiled evaluation against 2.5 ms
    for `evaluatePattern` (Bun, one core), so per-node allocation in the expression evaluator
    (about a third of the remaining time) is not worth optimising yet.
16. **Limits on untrusted definitions.** The validator rejects, as `invalid_definition` at the
    section's path, any section (`measurements`, `parameters`, `formulas`, `points`, `curves`,
    `pieces`) with more than `MAX_SECTION_ENTRIES` (20 000) entries and any outline with more than
    `MAX_OUTLINE_ENTRIES` (1 000), and, at `/pieces`, outlines with more than
    `MAX_SECTION_ENTRIES` entries in total across all pieces (so many large outlines cannot add up
    to millions of entries); a block has a few hundred points, so these only bound the work a
    hostile definition can cause. Formulas keep the limits of ADR 0003 (10 000 characters,
    nesting depth 100). A computed position, before or after the user offset, more than
    `MAX_COORDINATE` (1e7 mm, 10 km) from the origin on either axis is `degenerate_geometry`, which
    keeps every length and SVG number finite and gives every point in `points` a `basePoints`
    entry.
    Limits on the stored size of a definition (bytes per project, projects per user) belong to the
    Phoenix app and are set in ADR 0006 (200 000 bytes since ADR 0008, 100 projects per user).

Rejected alternatives:
- A schema/validation dependency (zod, a JSON Schema validator): a new dependency for a small
  fixed shape.
- Points as a JSON object keyed by name: an array keeps explicit order and per-element structure.
- Counter-clockwise "maths" angles: would need a sign flip against `atan2` in SVG coordinates.
- Outline closure by coordinates: depends on measurements, so an outline could be valid for one
  profile and not another.
- Adaptive arc length: recursion and variable cost on the drag path.
- A version bump for every additive field or op: strict validation already stops an older engine
  from misreading such a definition, so the bumps would only add trivial migrations.

## Consequences
- Stored definitions are versioned; changing the angle convention or any field meaning needs a
  version bump and a migration. Adding an optional field or an op does not, so the version number
  alone does not say which fields a definition uses; an engine older than a definition rejects it
  as `invalid_definition` rather than drawing it wrongly.
- The angle convention (0 = right, 90 = down) is confirmed. Changing it now needs a version bump
  and a migration of stored definitions.
- References between pieces or projects (0007) are not part of version 1: `length(curve)` only sees
  curves of the same definition. Until then the caller measures across patterns: evaluate pattern 1,
  read `curves.<name>.length` or a formula value, and pass it as a measurement to pattern 2.
