---
id: 0015
title: Pattern markings and seam allowance display
status: todo
type: feature
---

## Background
A pattern cannot be cut out and sewn without markings, and the user must be able to tell the seam
line from the cutting line and to change the seam allowance where it matters (for example 0 at a
fold).

## Desired behaviour
Each pattern piece gets a default seam allowance (1 cm) that can be changed per edge. Pattern pieces
show grainline, notches, fold line, name and cutting instructions, and the project view draws the
seam line and the cutting line so they are easy to tell apart.

## Acceptance criteria
- [ ] Markings in the block definitions: notches (balance marks), fold line, piece name, and "cut 2" / "cut 1 on fold" ("klipp 2" / "klipp 1 i fold"), shown together with the grainline arrow.
- [ ] The project view draws the seam line dashed and the cutting line solid.
- [ ] The seam allowance can be set per edge in the UI (including 0, e.g. at a fold line). The default value (1 cm) is set per project and stored on the project.

## Out of scope
- Computing the seam allowance outline (0009).
- Buttonholes, pocket placement.

## Notes
Split from the original 0009 ("Seam allowance and markings").
- Depends on 0007: the notches on the sleeve cap must match the notches on the bodice armhole.
- Depends on 0008: setting the seam allowance per edge uses the editor's selection and side panel.
- Consumes the engine API from 0009 (seam allowance per outline edge, with a default passed by the
  caller); the cutting line itself is computed in the engine, not here.
- Engine consumer notes (`docs/adr/0007-seam-allowance.md`): fit the `viewBox` to the cutting-line
  points (the line lies up to about 4.12 times the largest allowance from the outline); render
  error messages as text, never HTML (curve names are user-controlled); show `approximations`
  (`safe_construction`, `dart_without_peak`) to the user when present.
