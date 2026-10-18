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
   such as `distnce` are caught. The version is bumped for any change an older engine could
   misread, including new optional fields and new `op`s (they are rejected as unknown). When version
   2 arrives, an explicit migration `1 -> 2` is added in the engine, never silent reinterpretation.
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
   and Valentina use 90 = up; decide before 0005 writes the first block, as later stored
   definitions would change meaning.
7. **Perpendicular op.** A point at a signed distance on the perpendicular erected at `from` on
   `from -> to`. Dropping a foot point onto a line is not added; add an op (new version) when a block
   needs it.
8. **Geometry functions via the injectable table** (ADR 0003 decision 8): `distance(A, B)`,
   `angle(A, B)` and `length(curve)` with `takes: "names"`, in a table that closes over the computed
   points and curves. Not added: `x(A)` / `y(A)`; `length` takes one curve (sum with `+`).
9. **One dependency graph.** Formulas, points, curves and pieces are nodes of the same
   `evaluateGraph` (ADR 0003 decision 4): ordering by dependency, one `circular_dependency` per
   cycle, `failed_dependency` for dependants, partial results. Pieces are leaves that fail through
   their curves and grainline points.
10. **Error model.** Errors are values. Structural errors (`invalid_definition`,
    `unsupported_version`) carry a JSON-pointer `path`, are reported all at once and stop evaluation.
    Semantic errors carry `name` (the element), an optional `field` (where inside it) and a `span`
    into that field's string, and evaluation returns whatever still computed.
11. **Outline closure by point name.** A piece outline is an ordered list of curve names; the `to`
    point of each curve must be the `from` point of the next, cyclically, else `open_outline`.
    Curves are traversed in their defined direction; no reversed segments in v1 (a later version
    can add `{ "curve": "x", "reversed": true }`). Checking by name rather than by coordinate keeps
    validity independent of the measurements.
12. **Arc length by fixed composite Gauss-Legendre** (5 points on 16 sub-intervals, raised if
    accuracy requires), within 0.01 mm of a fine polyline reference; lines use `distance`.
    Deterministic and fixed cost on the drag path.
13. **SVG output** is `M/L/C/Z` path data in mm user units, rounded to 0.01 mm with no `-0`. The
    caller chooses the `viewBox`.
14. **No schema file.** The TypeScript validator is the source of truth. How the Phoenix app
    validates stored definitions is decided in 0005/0008 (Elixir validates but never computes
    geometry).

Rejected alternatives:
- A schema/validation dependency (zod, a JSON Schema validator): a new dependency for a small
  fixed shape.
- Points as a JSON object keyed by name: an array keeps explicit order and per-element structure.
- Counter-clockwise "maths" angles: would need a sign flip against `atan2` in SVG coordinates.
- Outline closure by coordinates: depends on measurements, so an outline could be valid for one
  profile and not another.
- Adaptive arc length: recursion and variable cost on the drag path.

## Consequences
- Stored definitions are versioned; changing the angle convention or any field meaning needs a
  version bump and a migration.
- Switching the angle convention before 0005 touches only `vector.ts`, `functions.ts`, their tests
  and this ADR.
- References between pieces or projects (0007) are not part of version 1: `length(curve)` only sees
  curves of the same definition.
