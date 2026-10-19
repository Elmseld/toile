---
id: 0009
title: Seam allowance in the engine
status: in-review
type: feature
---

## Background
A pattern cannot be cut out without seam allowance. The cutting line is geometry, so the engine
computes it, and the project view (0015) and the PDF export (0010) draw what the engine returns.

## Desired behaviour
Given a pattern piece and a seam allowance for each of its outline edges, the engine returns the
cutting line around the piece: the outline offset outwards, with correct corners and darts.

## Acceptance criteria
- [ ] The engine computes a seam allowance outline (offset) around each pattern piece, with correct corners where edges meet, including at curves.
- [ ] The seam allowance is engine input per outline edge (including 0, e.g. at a fold line), with a default value that the caller passes.
- [ ] The seam allowance at darts gets the correct dart peak (shaped as if the dart were closed and pressed, so the cut edge is right when sewn), or a simpler approximation is documented in an ADR.
- [ ] Engine tests for the offset of a rectangle, a curve and a piece with a dart.

## Out of scope
- Markings in the block definitions, drawing the seam and cutting lines, and setting the seam
  allowance in the UI: all in 0015.
- Buttonholes, pocket placement.

## Notes
Split from the original 0009 ("Seam allowance and markings"); the markings and the UI moved to 0015.
