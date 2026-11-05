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
- **The client owns the edit state** of every part of the project (the main block and added
  blocks such as a sleeve, ADR 0007): the working definitions, parameter overrides, selection and
  undo/redo history (at most 100 steps over all parts, lost on reload). A history state is
  `{parts: {name: {definition, parameters}}}`; an edit replaces one part's entry and shares the
  others. A point is addressed by part and name. The pure helpers (`setUserOffset`,
  `setPointFormula`, `tryPattern`, history, units, `pickPoint`, `controlPoints`) live in
  `engine/src/editor/`, work on the raw stored JSON and are tested with the engine.
- **The server stores and validates, never computes.** The hook sends `save_pattern` per part,
  `{part, definition, parameters}`, with the part's whole definition and parameter overrides
  (`Toile.Patterns.update_pattern_edits/4`). The main part is checked against the project as the
  page loaded it and updates its own columns; an added part is checked against the stored row,
  read again and locked, so a part added meanwhile in another tab is kept. Both run the same
  check (`PatternProject.validate_edit/2`). `Toile.Patterns.DefinitionEdit` compares it with the
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
  stays. A commit saves the parts whose present state is not stored yet, one part per save. One
  save is in flight at a time: when its reply comes, the next unstored part (or a newer state of
  the same one) is sent, so a held-down undo key does not send a save per step. After a reconnect
  the unsaved parts are sent again, at most three times in a row with a growing delay.
  A save without a reply within 10 seconds counts as failed, and a reconnect forgets the saves
  sent before it; their late replies are ignored, so a lost reply cannot stall the autosave.
- **Drag hot path.** All parts are evaluated together with `compileProject`, compiled again only
  when a definition changes, so a sleeve follows an edit of the bodice armhole. Each pointer move
  does one `evaluate(input, { offsets: { part: { point: offset } } })` and updates existing SVG
  elements in `requestAnimationFrame`, notch marks included. The parts are laid out side by side
  when the drawing is built and keep their place during edits, so a dragged point stays under the
  pointer.
  `placeLabel` (7 to 14 ms per piece) is not called during a drag: labels keep their place and are
  recomputed at drag end through a cache keyed by outline, text and grainline. Typing in a formula
  or parameter field is coalesced the same way: one evaluation per animation frame, drawn with the
  labels in place, and the labels are placed again after a 150 ms pause in typing or on the
  field's `change`.
- **Unit conversion lives in the engine only.** The server renders parameter values raw (mm,
  degrees) in data attributes and leaves the inputs and "Default" hints empty; the hook fills
  them with `engine/src/editor/units.ts`. The server's bounds on parameter overrides and user
  offsets equal the engine's `MAX_PARAMETER` and `MAX_COORDINATE`, pinned by
  `test/toile/patterns/engine_limits_test.exs`.
- **A save fits one websocket frame.** The endpoint closes the socket on a frame over 256 000
  bytes, so a save (one part's definition plus parameter overrides, encoded) is capped at
  240 000 bytes and
  a stored definition at 200 000 (`Toile.Patterns.DefinitionSize`; ADR 0006 had 1 000 000). Every
  stored project can be saved again; the hook reads both caps from `data-max-save-bytes` and
  `data-max-definition-bytes` and does not send a save over either. Blocks are far below it (the
  bodice is about 19 000 bytes). Lowering the cap needs no data migration: before this ADR a
  definition only entered the database as a copy of a block (`put_block_definition`), and
  `Toile.Patterns.Blocks.Loader` refuses at compile time any block over the cap, so no stored row
  exceeds 200 000 bytes.
- **Edit saves are not broadcast** on the user's project topic: the editor saves on every
  commit, and the project list shows nothing an edit changes. A rejected save is logged at info
  level with the failing fields and the JSON pointer of the first difference, never values.
- The hook element no longer sits in a profile-keyed wrapper, so switching between profiles that
  have every measurement the pattern needs keeps it and the undo history. It reads the parts from
  `data-parts` on mount and redraws when `data-key`, `data-parts` or `data-input` change (amends
  the "Client" paragraph of ADR 0006); from a later `data-parts` it only takes parts it does not
  have yet (a part added on the page), which join every state of the history. The editor aside's
  id names the parts, so adding a part renders a new aside, which the hook moves the editor to;
  it is keyed by that id in a one-entry comprehension so LiveView renders it in full instead of
  sending unchanged function components as placeholders for the old aside's elements. A profile
  with missing measurements replaces the drawing with a list of them, which removes the hook: the
  history is lost, and the parts not stored yet are sent once more as the editor goes.

## Alternatives rejected
- Server-owned edit state: a round trip per edit, and formula validation needs the engine.
- Saving the whole definition with no diff check: would allow renaming points and changing the
  interface other blocks use.
- An Elixir copy of the op table: two sources of truth.
- An explicit save button only: easy to lose work.

## Consequences
- A new op goes into `point_ops.json`; the app and the editor pick it up, and tests ask for UI texts
  for it.
- Amended by ADR 0011 (ticket 0015): the history state is `{parts, seamAllowances}` and the save
  queue has one unit that is not a part, the project's seam allowances. Pieces stay uneditable.
- Named formulas (the `formulas` section), curves and pieces cannot be edited yet.
- Undo history does not survive a reload, nor a switch to a profile with missing measurements;
  the saved state does.
- Last write wins. A save replaces the stored definition and parameters of its part whole, with
  no version check: with the same project open in two tabs, each save silently overwrites the
  other tab's work on that part. An optimistic lock is left for later.
- A part cannot be removed (ADR 0007), so the editor only ever gains parts.
