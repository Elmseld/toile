---
id: 0005
title: Skirt block and viewing pattern projects
status: todo
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

## Open questions
- **Angle convention (decide before the first block is stored).** The engine uses degrees with
  0 = right and 90 = down (clockwise on screen, `atan2(dy, dx)` in SVG coordinates), for
  `angle(A, B)`, `along_angle` and `perpendicular` (ADR 0004 decision 6). Seamly2D and Valentina
  use 90 = up. Confirm the current default or switch before "Rak kjol" is written: afterwards a
  switch changes the meaning of stored definitions and needs a format version bump and a migration.
  Switching touches only `engine/src/geometry/vector.ts`, `functions.ts`, their tests and ADR 0004.

## Notes
The blocks live as data in the repo (e.g. `engine/blocks/`) and are copied into the project when it is created.
Later changes to a block therefore do not affect existing projects.
