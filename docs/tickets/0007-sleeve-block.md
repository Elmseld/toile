---
id: 0007
title: Sleeve block, fitted to the bodice
status: in-progress
type: feature
---

## Background
A sleeve must fit the armhole it is sewn into. The length of the sleeve cap depends on the bodice armhole.

## Desired behaviour
When the user creates a bodice project, a sleeve can be added. The sleeve is drafted from the
measurements and from the bodice armhole length, and is recomputed when the bodice changes.

## Acceptance criteria
- [ ] The block "Rak ärm" (Straight sleeve; a simple one-piece sleeve) as a pattern definition, with parameters for sleeve length, width, and cap height/cap ease.
- [ ] The sleeve can reference values from another pattern piece in the same project (the armhole length).
- [ ] Sleeve cap length = armhole length + cap ease, within 2 mm, verified with an engine test.
- [ ] If the bodice changes so that the armhole gets longer, the sleeve follows.
- [ ] Notches (front/back) are marked on the sleeve cap and at the corresponding place on the armhole.

## Out of scope
- Two-piece sleeve, puff sleeve and other variants.

## Notes
Requires that a project can contain several pattern pieces from different blocks.
The planner decides how references between them are expressed in the pattern definition.
The bodice (0006) exposes the armhole as three `values` keys: `armhole_length`,
`back_armhole_length` and `front_armhole_length` (mm). Their names are a stable interface (pinned
by an engine test; renaming one requires migrating stored project definitions, ADR 0006). How the
sleeve consumes them is for this ticket to decide. The bodice's front and back shoulder points are
always level, but its front armhole is about 10 to 17 mm longer than the back one in the test
figures (shape of the front armhole curve), so the sleeve should not assume front and back
armholes of equal length.

## Decisions
- **Drafting method:** based on Aldrich, *Metric Pattern Cutting for Women's Wear*, 6th ed., the
  one-piece sleeve. Deviations are stated in the block's `source`: the cap is constructed (two
  circular arcs per half with an optional straight middle) rather than drawn, its height is solved
  so the cap equals the imported bodice armhole plus `cap_ease`, the crown is shifted so each half
  matches its own armhole half, all cap ease lies between the notches, and the hem tapers to
  wrist plus ease.
- **Starting values are ours:** `ease_upper_arm` 50, `ease_wrist` 80, `cap_ease` 30,
  `cap_convex_share` 0.6, `length_adjustment` 0 (mm). They are pinned by engine tests and to be
  adjusted after test fitting (a toile).
- **Cap height is computed**, not a parameter, so the cap always fits; sleeve width and cap ease
  are the parameters. A sleeve wider than its armhole gives an error instead of a drawing.
- **Imports and parts:** the sleeve takes the bodice's armhole values through `imports`, and a
  project holds the bodice as its main part and the sleeve as an added part: ADR 0007.
- **Notches:** a piece field (ADR 0004 decision 17). Bodice: double at the back width point,
  single at the chest point. Sleeve: double at the back, single at the front and a single at the
  crown.
- **UI:** the sleeve is added from the project page ("Lägg till i mönstret" > "Rak ärm"), not in
  "Nytt mönster", so existing bodice projects can get one. Bodice projects created before this
  ticket lack the values the sleeve imports and are not offered it. Removing a sleeve is not part
  of this ticket.
