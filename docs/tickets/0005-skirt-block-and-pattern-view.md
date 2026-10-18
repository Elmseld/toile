---
id: 0005
title: Skirt block and viewing pattern projects
status: in-progress
type: feature
---

## Background
The skirt is the simplest block and the first to show the whole chain from measurements to pattern.
This is also where pattern projects and the first view are created.

## Desired behaviour
The user clicks "Nytt mönster" (New pattern), chooses the block "Rak kjol" (Straight skirt) and a
measurement profile, and gets a project that shows the front and back pieces drawn in SVG in the
correct proportions, with zoom and pan.

## Acceptance criteria
- [ ] The block "Rak kjol" as a pattern definition: front and back pieces with waist darts and a hip curve, following an established metric drafting method (the source is stated in the definition).
- [ ] Ease at waist and hip, and skirt length, are parameters with sensible defaults.
- [ ] Pattern projects are stored per user: name, block, measurement profile, pattern definition (JSON) and parameter values.
- [ ] "Mina mönster" lists the projects. Projects can be created, renamed and deleted.
- [ ] The project page draws the pattern with the engine on the client (JS hook), with zoom (wheel/pinch) and pan (drag), and shows a grid in cm.
- [ ] Switching measurement profile recomputes the pattern. If measurements the pattern needs are missing, it shows which ones instead of a broken pattern.
- [ ] An engine test verifies that the skirt's waist and hip (seam line, without darts) equal measurement + ease within 1 mm.

## Out of scope
- Editing points (0008). Seam allowance (0009). Printing (0010).

## Decisions
- **Angle convention (resolved):** keep 0 = right, 90 = down (ADR 0004 decision 6, now confirmed).
- **Drafting method:** Aldrich, *Metric Pattern Cutting for Women's Wear*, 6th ed., close fitting
  skirt block. The constants are parameters; the definition notes they are not yet checked against
  the book.
- **Skirt length:** the `skirt_length` measurement plus a parameter `length_adjustment` (default 0 mm).
- **Ease defaults:** hip 40 mm, waist 10 mm.
- Architecture: `docs/adr/0006-pattern-projects-and-blocks.md`.

## Notes
The blocks live as data in the repo (e.g. `engine/blocks/`) and are copied into the project when it is created.
Later changes to a block therefore do not affect existing projects.
