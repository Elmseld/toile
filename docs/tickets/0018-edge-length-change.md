---
id: 0018
title: Show how much an edge has grown or shrunk in the editor
status: todo
type: feature
---

## Background
In the pattern editor (ticket 0008, `docs/adr/0008-pattern-editor.md`) the user drags points and
edits formulas and parameters, but nothing tells them what that did to the length of a seam. A
dressmaker adjusting a block thinks in terms like "I took 1,5 cm off the side seam" or "the waist
got 2 cm longer". Today they would have to measure on the screen or on paper. Lengths also matter
for sewing two edges together: the sleeve cap has to be the armhole plus the cap ease, and the
sleeve block already computes this (`back_cap_length`, `front_cap_length`, `cap_length` against
the bodice's `back_armhole_length`, `front_armhole_length` and `armhole_length`). But once the user
edits the armhole or the cap, they cannot see whether the two still match.

## Desired behaviour
When the user selects an edge of a pattern piece (the same edge selection that 0015 adds for the
per-edge seam allowance), the editor shows:
- how long the edge is now, and
- how much longer or shorter it is than the same edge in the **unedited block**. The unedited block
  is the block with none of the project's edits (no point offsets, no formula changes, no
  parameter overrides), evaluated with the same measurement profile.

The values update live while a point is dragged or a formula or parameter is typed, the same way
the drawing does. For the sleeve, the editor also shows how the sleeve cap compares with the
armhole it is sewn into, so the user can see the cap ease after their edits.

Example UI text (Swedish, final wording up to the implementer):
- "Längd: 24,3 cm"
- "Ändring: +1,2 cm" / "Ändring: −0,8 cm" / "Ändring: 0,0 cm" (or "Oförändrad")
- "Ärmkulle: 47,1 cm · Ärmhål: 44,1 cm · Inhalning: 3,0 cm"

## Acceptance criteria
- [ ] Selecting an edge (`<part>.<curve>`, as in 0015) shows its current length in cm with one
      decimal in the side panel.
- [ ] The panel also shows the difference against the same edge in the unedited block, evaluated
      with the current measurement profile. The sign is explicit (`+` longer, `−` shorter), in cm
      with one decimal. An unedited edge shows a difference of 0 (or an equivalent "unchanged"
      text).
- [ ] The baseline follows the measurements: switching to another measurement profile recomputes
      both the current length and the unedited length, so the difference shows only the user's
      edits, not the change of measurements.
- [ ] Edits on another part that change this edge count too. For example, dragging a bodice
      armhole point changes the sleeve cap and so the sleeve cap edges' difference.
- [ ] Dragging a point updates the shown length and difference on every pointer move, with no
      server call. Typing in a formula or parameter field updates them the same way as the
      drawing. Undo and redo update them.
- [ ] After a reload the panel shows the same lengths and differences as before the reload: the
      edits are stored, and the baseline does not depend on the session's undo history.
- [ ] While a formula is invalid (the drawing keeps its last good state, ADR 0008) the panel keeps
      the values of that last good state and shows no `NaN` or empty values.
- [ ] Sleeve projects: the panel shows the total sleeve cap length, the armhole length and the
      difference between them (the cap ease), both per half (back, front) and in total. It also
      shows how far each of these is from the block's intended value (`cap_ease`, split per half
      as the block does), so the user can see that an edit has thrown the cap out of balance.
      The values update live like the edge lengths.
- [ ] All lengths are computed in the engine (`engine/`), with engine tests for the edge length,
      the unedited baseline and the cap-to-armhole comparison. The Phoenix side computes no lengths
      (`docs/product.md`, "All geometry is calculated in the engine").
- [ ] All new UI text goes through gettext with Swedish translations
      (`priv/gettext/sv/LC_MESSAGES/default.po`). The LiveView test covers that the panel elements
      and texts are rendered. The live behaviour is covered by engine tests and, where it is
      practical, a JS/hook test.

## Out of scope
- Matching other seam pairs (front and back side seams, shoulder seams, skirt side seams) and
  declaring seam pairs in the block definitions in general. This is a natural follow-up once the
  sleeve cap comparison exists.
- Changing a length by typing a target length (for example "make this edge 1 cm shorter"). The
  editor stays point- and formula-based.
- Lengths of the cutting line (seam allowance outline, 0009). This ticket measures the seam line,
  that is, the piece outline.
- Showing lengths on the drawing itself (labels along the edges). The panel is enough for now.
- Printing lengths in the PDF (0010).

## Notes
- Depends on 0015 (PR #16) for edge selection in the editor. If 0015 changes how an edge is
  addressed, follow it.
- What "the unedited block" is needs a decision from the planner. A project stores a copy of the
  block definition and saves edits into that copy (ADR 0006, ADR 0008), so the copy as it was
  created is not kept. Possible baselines: the copy with `user_offset`s removed but formula edits
  kept, the current block in `engine/blocks/` (which may have changed since the project was
  created), or a stored original copy. Record the choice in an ADR or an amendment to ADR 0008.
  The criteria above assume formula and parameter edits count as edits.
- Keep the drag hot path in mind (ADR 0008): the baseline does not change during a drag, so it
  probably only needs evaluating when the measurements, the parts or the selected edge change,
  not on every pointer move.
- The sleeve block's `cap_length` and the bodice's `armhole_length` are named formulas that other
  code already depends on (ADR 0008). Read them; do not rename them.
- Lengths are millimetres in the engine and storage; only the UI shows centimetres
  (`engine/src/editor/units.ts`).
