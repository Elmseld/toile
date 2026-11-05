# 0011: Markings and seam allowance storage

Status: accepted (ticket 0015)

## Context
ADR 0009 computes the cutting line in the engine from allowances passed by the caller, and leaves
storage and display to 0015. A piece also needs markings (cutting instruction, fold line, notches on
the cutting line), and the user must set the allowance per edge, including 0 at a fold.

## Decision
1. **Allowances are stored on the project, outside the definition.** One jsonb column
   `pattern_projects.seam_allowances`, an `embeds_one` (`Toile.Patterns.SeamAllowances`):
   `{"default": 10, "edges": {"<part>": {"<curve>": 0}}}`, in mm. Edges are keyed by part first
   because curve names are only unique within one definition. Existing projects get the default
   10 from the migration. `DefinitionEdit` is unchanged: pieces stay uneditable (ADR 0008).
2. **Validation.** `save_seam_allowances` (LiveView event, reply `%{ok: boolean}`) calls
   `Patterns.update_seam_allowances/3`, which re-reads the row under lock and accepts only: a
   default number in 0..100, every edge key a part of the project and a curve in that part's piece
   outlines, every value a number in 0..100. Anything else is rejected and nothing is stored. The
   settable curves come from `Patterns.outline_curves/1`, which also builds the edge select, so the
   select offers exactly what the server accepts. The bound equals the engine's
   `MAX_SEAM_ALLOWANCE`, and the default equals `DEFAULT_SEAM_ALLOWANCE`; `engine_limits_test.exs`
   pins both. No atoms are made from keys. The server does not broadcast. A CHECK constraint
   (`seam_allowances_must_have_default_and_edges`) requires an object with a number `default` and
   an object `edges`, so every row loads; it is added NOT VALID and validated in a separate
   migration, so the scan does not run under the ACCESS EXCLUSIVE lock.
3. **`fold` and `cut` are block data** (ADR 0004 decision 19), since they describe the piece and
   the PDF (ticket 0010) needs them. The blocks mark skirt back cut 2, skirt front cut 1 on fold
   (`f_cf`), bodice back cut 1 on fold (`b_cb`), bodice front cut 1 on fold (`f_cf`), sleeve cut 2,
   plus hip notches on the skirt side seams (double at the back).
4. **Fold edge rule.** A fold edge's allowance is 0 unless the user set a value for that edge; the
   project default never applies to it. The engine's `pieceSeamAllowances(piece, default, edges)`
   implements it, shared with the PDF.
5. **Editor.** The history state is `{parts, seamAllowances}`. The save queue gets one unit that is
   not a part, `#seam_allowances` (no part name contains `#`), pushed as `save_seam_allowances`.
   The pattern result does not depend on allowances, so a change redraws without re-evaluating.
   The client parses allowances tolerantly (`readSeamAllowances`) and drops invalid entries.
   `data-seam-allowances` is assigned once in `assign_state` and never derived from `@project`, so
   a save reply does not patch the hook (ADR 0008).
6. **Cutting-line notches.** `cuttingLineNotches` moves each mark along its own line, outwards, to
   the cutting line and keeps `NOTCH_LENGTH`, pointing inward. The marks on the seam line stay.
7. **Two-line labels** (name, then cutting instruction): see ADR 0006, "Piece labels".
8. **Cutting line per update, cached.** This amends ADR 0009's "compute it once per drawn input".
   The hook computes `cuttingLine` for every piece on each update, including each frame of a drag,
   with a cache that holds each piece's latest line, keyed by its path data, curve names and
   effective allowances. Outlines have at most 13 entries because pieces are not editable, a line
   costs about 0.25 ms, evaluations are already coalesced per frame, and unchanged pieces hit the
   cache. The fit and the layout cover the cutting lines (`patternBounds` takes the lines). A
   failed line or its `approximations` is shown as plain text (`#pattern-notes`), never as HTML.
9. **Pieces are laid out apart within a part.** A block draws its pieces at fixed places (the
   skirt's front and back 50 mm apart), so wide allowances would make their cutting lines
   overlap. The engine's `layoutPieces` moves the pieces of a part right, by their boxes with the
   cutting lines, until every two are `PIECE_GAP` (20 mm) apart horizontally or vertically;
   pieces with room enough stay where the definition puts them. `layoutParts` then places the
   parts by the boxes it returns. The view draws each piece translated by its own offset, and
   every mapping between screen and part coordinates (handles, point picking and dragging, edge
   tap and highlight) uses the same offsets; a point goes with the piece `pointPieces` gives it
   (the first piece that uses it, else the nearest). The layout is redone when the drawing is
   built and when committed allowances change, not during a drag.

## Alternatives rejected
- A `seam_allowance` field on outline entries: needs piece edits in `DefinitionEdit` and
  contradicts ADR 0009.
- Per-part storage (project column for the main part plus a `PatternPart` field): the default is
  project-level, so it needs a second save unit next to `save_pattern` and an extra field in
  every part save.
- A separate table: ownership machinery for a tiny map.

## Consequences
- Projects created before 0015 have no `fold`/`cut` or skirt notches (ADR 0006); the user can set
  0 at a fold by hand. There is no data migration of definitions.
- Dart-leg edges are listed and settable, but `cuttingLine` ignores their allowances (ADR 0009); the
  server cannot detect darts.
- Setting a value on a fold edge moves the line off the fold while the instruction still says
  "on fold".
