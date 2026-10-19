---
id: 0006
title: Bodice block
status: in-review
type: feature
---

## Background
The bodice block is the foundation for tops and dresses and the most complex block.

## Desired behaviour
The user can create a project from the block "Liv" (Bodice) with front and back pieces,
computed from the measurement profile.

## Acceptance criteria
- [x] The block "Liv" as a pattern definition: back with shoulder dart and waist dart, front with bust dart and waist dart, neckline and armhole curves. The source of the drafting method is stated.
- [x] Ease at bust, waist and armhole depth are parameters.
- [x] The armhole length (front + back) is exposed as a measurable value, so that the sleeve (0007) can use it.
- [x] Engine tests verify that the bust and waist circumference of the finished pattern equal measurement + ease within 2 mm, and that the front and back shoulder seams are equally long (± 1 mm, including any shoulder dart).
- [x] Can be selected under "Nytt mönster".

## Out of scope
- Princess seams, dart manipulation and other design changes.

## Notes
Builds on the engine (0002, 0003) and the project view (0005).

## Decisions
- **Drafting method:** Aldrich, *Metric Pattern Cutting for Women's Wear*, 6th ed., the close
  fitting bodice block. Deviations are stated in the block's `source`: back and front are drafted
  in separate frames 50 mm apart, and the bust dart is derived (below) instead of taken from a
  size chart.
- **New measurement `armhole_depth`** ("Nacke till armhålsnivå", nape straight down the spine to a band
  tied level as high under the arms as it goes), added to the catalogue per ADR 0005. The profile has 18 measurements; existing
  profiles lack it (not measured) and existing skirt projects are unaffected.
- **Bust dart from the bust excess:** the dart angle is `bust_dart_rate` (0.12 degrees per mm)
  times the amount by which `bust / 2 - chest_width` exceeds `bust_dart_offset` (50 mm),
  between 0 and `max_bust_dart_angle` (20 degrees). These are draft constants, not from the
  book. They are calibrated so that the size 12 test set and a larger set draft their measured
  front length within 1 mm. The bust point lies `bust_height` from the front neck point. The
  front neck point is placed so that the front shoulder point, dart open, is level with the
  back shoulder point. Needs `bust_height` and `bust_distance`. `front_length` is no longer a
  bodice measurement; the catalogue key stays.
- **Why not `front_length`:** the first version placed the front neck point from
  `front_length` and took the dart as the rotation that levels the shoulders. The dart then
  grew by about 2 mm per mm of `front_length` (a small difference of two long measurements). A
  real profile got a capped 15 degree dart, a front shoulder 27 mm above the back one and a
  front armhole 42 mm longer than the back. The new dart moves under 0.8 mm per mm of
  `chest_width` and under 0.4 mm per mm of `bust` (tested). The front always meets the back at
  the shoulder.
- **Wide back width is not corrected:** a `back_width` that puts the back width point outside
  the shoulder point (e.g. 450 mm with a 125 mm shoulder and 355 mm neck) gives an S-shaped back
  armhole. That is treated as a measuring error. The block has no guard.
- **Ease defaults:** bust 80 mm, waist 40 mm, armhole depth 10 mm. These and the draft constants are
  parameters, not yet checked against the book.
- **Armhole length:** the bodice exposes three `values` keys, `armhole_length`,
  `back_armhole_length` and `front_armhole_length` (formulas using `length(curve)`, ADR 0004
  decision 8). No engine change. How the sleeve consumes them is left to 0007. The three names are
  a stable interface: renaming one requires migrating the block copies stored in pattern projects
  (ADR 0006); an engine test pins them.
- **Measurement definitions in tests:** the bust line is the horizontal line through the underarm
  points, net of any dart it crosses; the waist is the sum of the waist seam segments (dart legs
  excluded); a shoulder seam is the sum of its two segments (dart closed). AC4's "including any
  shoulder dart" is read as the seam once the dart is sewn closed, which is what is joined to the
  other piece; the drafted back shoulder line is longer than the front by the back shoulder dart
  intake (`back_shoulder_dart`) by design.
- **Block select:** with two blocks nothing is preselected; the select has the prompt
  "Välj ett grundmönster" (msgid "Choose a block").
