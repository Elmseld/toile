---
id: 0019
title: Readable point and edge names in the pattern editor
status: todo
type: feature
---

## Background
The pattern editor's side panel (`lib/toile_web/live/pattern_live/show.ex`) has two selects that
list parts of the pattern by their internal definition names:

- the point select ("Välj en punkt", `point_options/1`, from ticket 0008), and
- the seam allowance edge select ("Välj en kant", `edge_options/1` / `part_edge_options/2`,
  from ticket 0015 / PR #16).

Both show names such as `b_side_lower`, `f_dart_apex` or `s_fc1`. These are identifiers for the
engine and for formulas, not words a home sewer recognises, so finding the right point or edge
in a list of dozens means guessing or clicking around in the drawing. The block definitions
currently hold 117 points and 51 outline curves (`engine/blocks/straight_skirt.json`,
`bodice.json`, `straight_sleeve.json`).

Block and piece names already have translated labels (`ToileWeb.BlockTexts`), and parameters and
measurements have theirs (`ToileWeb.ParameterTexts`, `ToileWeb.MeasurementTexts`). Points and
curves are the remaining definition names the UI shows raw.

## Desired behaviour
The point and edge selects show a readable Swedish name for every point and outline curve that
comes from a block, for example "Sidsöm, nedre del" for `b_side_lower` and "Inprovningens spets"
for `f_dart_apex`. Like all UI text, the labels are written in English in the code and translated
through gettext (CLAUDE.md, UI text rules); no Swedish is hardcoded.

Names that have no label (a point or curve the user created in the editor, or one in an old
project copy whose definition differs from the current block) are still listed, under their raw
name.

## Acceptance criteria
- [ ] Every point and every outline curve in the three block files has a label, and the point
      select and edge select show that label instead of the raw name. A test fails when a point or
      outline curve is added to a block file in `engine/blocks/` without a label (compare
      `test/toile_web/block_texts_test.exs`).
- [ ] Every label has a Swedish translation (`test/toile_web/gettext_test.exs` stays green).
- [ ] Labels are unambiguous within what one select shows: no two options in the same group
      (one part's points; one piece's edges) have the same visible text. Front and back
      counterparts may share a label when they are in different groups.
- [ ] A point or curve without a label (user-created, or from an older project copy) is listed
      with its raw name as the option text. It is rendered as text only, never as HTML (names are
      user-controlled).
- [ ] The option values stay `<part>.<name>` (the raw name), so selecting, the editor hook and
      saving behave exactly as before; existing tests on option values still pass unchanged.
- [ ] Bézier control points (points used as a curve's `c1` or `c2`, 22 of them today, e.g.
      `b_neck_c1`, `b_hip_ctrl`, `s_fc1`; note that their names do not follow one suffix) are
      handled by a deliberate, documented choice: either listed in a separate group after the
      other points (e.g. "Kurvhandtag"), or listed with a label that says what curve they shape
      (e.g. "Halsringning, handtag 1"). They are not silently dropped, because they can be dragged
      in the drawing and their formulas edited.
- [ ] The same readable name is shown wherever the selected point or edge is named in the side
      panel, not only in the select: the edge heading in `#edge-details` (`#edge-name`, filled by
      `assets/js/editor/panels.js`, currently the raw curve name in a monospace font) and the
      corresponding heading or text in the point details, if any.
- [ ] Formula fields keep using raw point names: they are formula syntax, not display text.

## Out of scope
- Renaming points or curves in the block definitions, or migrating stored projects.
- Letting the user give their own points or curves a display name.
- Translating raw names inside formula error messages ("There is nothing called %{name}.",
  `ToileWeb.EditorTexts`): those refer to what the user typed in a formula, so the raw name is
  the useful one there. The planner may reconsider this if a label can be shown alongside.

## Notes
- Other places that show definition names, for the planner to check while doing this:
  - `#edge-details` (see the criteria above).
  - `#pattern-notes`, the notes under the drawing (`assets/js/hooks/pattern_view.js`,
    `cuttingNotes`): today these use the piece label from `data-piece-labels`, so they should
    already be readable; check that nothing in them falls back to a raw curve or point name.
  - Any engine error or approximation text that names a curve (ADR 0009: curve names are
    user-controlled and must stay text only).
- The labels belong to the definition names, which are shared between blocks only by
  convention (`b_`/`f_`/`s_` prefixes for back, front, sleeve). Whether labels are looked up by
  name alone or by block and name is the planner's call; a project's part keeps its own copy of
  the definition, so a lookup must cope with names that no longer exist in the block.
- The edge select groups by piece (`"<part>: <piece>"` with several parts); that grouping stays.
- Depends on 0015 (PR #16) for the edge select and `#edge-details`.
