---
id: 0008
title: Editor – move points and edit formulas and parameters
status: todo
type: feature
---

## Background
Pattern drafting means starting from a basic block and modifying it. The user must be able to
adjust the pattern directly, using mouse, touch and pen.

## Desired behaviour
On the project page the user can select a point and drag it, or open the point and edit its
formula. Parameters (e.g. ease) can be changed in a side panel. Everything is recalculated immediately.

## Acceptance criteria
- [ ] Points can be selected and dragged with mouse, touch and pen (pointer events). The drag is saved as an offset, and dependent points and curves follow along during the drag.
- [ ] Control points of Bézier curves can be dragged.
- [ ] A panel shows the selected point's operation and formulas. Edited formulas are validated, and errors are shown without the pattern disappearing.
- [ ] A parameter panel lists the pattern's parameters and lets the user change them.
- [ ] Undo and redo (at least 50 steps) within a session.
- [ ] Changes are saved to the project (autosave or an explicit save button). After a reload the same pattern is shown.
- [ ] Recalculation during a drag feels instant (no server calls per movement).
- [ ] A test (LiveView or JS) covers that a saved offset persists after a reload.

## Out of scope
- Adding new points and lines from scratch, moving darts, slash & spread.

## Notes
The engine runs in the client via the JS hook from 0005. The server receives and validates the pattern definition when saving.

Piece labels are placed by the engine's `placeLabel` (`engine/src/geometry/label.ts`), which
takes about 7 to 14 ms per bodice piece (about 20 ms per bodice render). Recomputing it on every
pointer move would eat most of a frame, so cache the placement per outline or recompute the
labels only after a drag ends.
