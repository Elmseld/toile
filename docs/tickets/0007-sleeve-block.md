---
id: 0007
title: Sleeve block, fitted to the bodice
status: todo
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
