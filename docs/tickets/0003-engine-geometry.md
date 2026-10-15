---
id: 0003
title: Pattern engine - points, curves and pattern pieces
status: todo
type: feature
---

## Background
Pattern blocks are drafted with classic construction steps: "point along line", "perpendicular
from", "intersection of two lines" and so on. The engine must be able to express and evaluate
them, so that the pattern is recomputed when the measurements change.

## Desired behaviour
A **pattern definition** (JSON) describes parameters, points, curves and pattern pieces.
The engine takes the definition and measurements and returns computed geometry, ready to draw as SVG.

## Acceptance criteria
- [ ] A documented and versioned JSON format for pattern definitions, with TypeScript types and validation.
- [ ] Point operations: start point, offset (dx, dy), along line (distance), along angle (distance + angle), perpendicular from line, line-line intersection, line-circle intersection, midpoint.
- [ ] All lengths and angles in the operations are formulas (from 0002) and can reference the distances and angles of earlier points.
- [ ] Curves: straight lines and cubic Béziers whose control points are also defined points.
- [ ] Pattern piece: an ordered closed outline of lines/curves, with a name and grainline.
- [ ] Functions for the length of a line/curve, so that e.g. the armhole length can be measured by other patterns.
- [ ] Every point can have a user offset that is applied after the computation.
- [ ] A helper that converts computed geometry into SVG paths.
- [ ] Unit tests for each operation, plus a small example pattern (a rectangle with a dart) tested against two different sets of measurements.

## Out of scope
- Seam allowance (0009), grading, UI.

## Notes
Coordinate system as in SVG: origin at the top left, y pointing down.
