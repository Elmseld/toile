---
id: 0010
title: PDF printing at 1:1 scale on A4
status: todo
type: feature
---

## Background
Most home sewers print patterns on a regular printer and tape the pages together.

## Desired behaviour
From the project page the user can download a PDF where the pattern is at 1:1 scale, tiled onto A4
with overlap, so the pages can be taped together.

## Acceptance criteria
- [ ] The PDF contains all pattern pieces at 1:1 scale, with the seam allowance and markings from 0009.
- [ ] The pages have a margin and alignment marks/edges for matching them up. Each page is labelled with row and column (e.g. "B3").
- [ ] The first page contains a test square of exactly 10 × 10 cm and an overview map of the pages.
- [ ] Empty pages (with no pattern) are not printed.
- [ ] An automated test checks that the test square is 10 × 10 cm in PDF coordinates (283.46 pt) and that a known line in the pattern has the correct length.
- [ ] The user chooses A4 or Letter (A4 by default).

## Out of scope
- A0/plotter, projector mode, marker layout.

## Notes
The PDF can be generated in the client or on the server using the engine's SVG output. The planner
decides, but the geometry must come from the engine (see the principles in `docs/product.md`).
