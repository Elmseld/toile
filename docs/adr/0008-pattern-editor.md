# 0008: Pattern editor

Status: accepted (ticket 0008)

## Context
The project page must let the user drag points, edit point formulas and change parameters with an
instant redraw (no server call per pointer move), undo/redo, and saved results. Only the engine can
parse formulas, and Elixir must never compute geometry (`docs/product.md`). The server still must
not trust what the client sends: a stored definition is also read by other code (the bodice's
`armhole_length`, `back_armhole_length` and `front_armhole_length` values are an interface for the
sleeve block, ticket 0007).

## Decision
- **The client owns the edit state**: the working definition, parameter overrides, selection and
  undo/redo history (at most 100 steps, lost on reload). The pure helpers (`setUserOffset`,
  `setPointFormula`, `tryPattern`, history, units, `pickPoint`, `controlPoints`) live in
  `engine/src/editor/`, work on the raw stored JSON and are tested with the engine.
- **The server stores and validates, never computes.** The hook sends `save_pattern` with the whole
  definition and the parameter overrides. `Toile.Patterns.DefinitionEdit` compares it with the
  stored definition and accepts only: `user_offset` added, changed or removed on a point; changes to
  a point's formula fields (at most 10 000 characters, ADR 0003); parameter overrides for
  parameters the definition declares. Point names, ops, name/line/`which` fields, `formulas`,
  curves, pieces, measurements, parameter defaults and every other top-level key must be equal.
  This protects names and the values other blocks depend on.
- **`engine/src/geometry/point_ops.json`** holds the field layout of every point op, with the kind of
  each field (`name`, `formula`, `line`, `which`). The engine builds its op table from it and
  `Toile.Patterns.PointOps` reads it at compile time to know which fields are formulas. Same
  pattern as `measurements.json` (ADR 0005): one file, no duplicated list.
- **Autosave on commit.** Nothing is saved during a drag or while typing. A commit (drag end, a
  field's `change`, offset reset, undo, redo) saves. The client commits only states whose evaluation
  is `ok`, so every saved state draws; an invalid formula shows an error and the last good drawing
  stays.
- **Drag hot path.** One compiled pattern per definition; each pointer move does one
  `evaluate(input, { offsets })` and updates existing SVG elements in `requestAnimationFrame`.
  `placeLabel` (7 to 14 ms per piece) is not called during a drag: labels keep their place and are
  recomputed at drag end through a cache keyed by outline, text and grainline.
- The hook element no longer sits in a profile-keyed wrapper, so switching profile keeps it and the
  undo history. It reads `data-definition` on mount only and redraws when `data-key` or
  `data-input` change (amends the "Client" paragraph of ADR 0006).

## Alternatives rejected
- Server-owned edit state: a round trip per edit, and formula validation needs the engine.
- Saving the whole definition with no diff check: would allow renaming points and changing the
  interface other blocks use.
- An Elixir copy of the op table: two sources of truth.
- An explicit save button only: easy to lose work.

## Consequences
- A new op goes into `point_ops.json`; the app and the editor pick it up, and tests ask for UI texts
  for it.
- Named formulas (the `formulas` section), curves and pieces cannot be edited yet.
- Undo history does not survive a reload; the saved state does.
