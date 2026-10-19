---
id: 0009
title: Seam allowance and markings
status: todo
type: feature
---

## Background
A pattern cannot be cut out without seam allowance and markings.

## Desired behaviour
Each pattern piece gets a default seam allowance (1 cm) that can be changed per edge. Pattern pieces
show grainline, notches, fold line and name.

## Acceptance criteria
- [ ] The engine computes a seam allowance outline (offset) around each pattern piece, with correct corners where edges meet, including at curves.
- [ ] The seam allowance can be set per edge (including 0, e.g. at a fold line). The default value is set per project.
- [ ] The seam allowance at darts gets the correct dart peak (shaped as if the dart were closed and pressed, so the cut edge is right when sewn), or a simpler approximation is documented in an ADR.
- [ ] Markings: grainline arrow, notches (balance marks), fold line, piece name, and "cut 2" / "cut 1 on fold" ("klipp 2" / "klipp 1 i fold").
- [ ] The seam line and cutting line are clearly distinguishable (e.g. dashed and solid).
- [ ] Engine tests for the offset of a rectangle, a curve and a piece with a dart.

## Out of scope
- Buttonholes, pocket placement.

## Notes
Notches already exist as an optional piece field and are drawn as short marks into the piece
(ADR 0004 decision 17, ticket 0007). This ticket adds them to the cutting line.
