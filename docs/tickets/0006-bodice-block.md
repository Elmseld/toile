---
id: 0006
title: Bodice block
status: in-progress
type: feature
---

## Background
The bodice block is the foundation for tops and dresses and the most complex block.

## Desired behaviour
The user can create a project from the block "Livstycke" (Bodice) with front and back pieces,
computed from the measurement profile.

## Acceptance criteria
- [x] The block "Livstycke" as a pattern definition: back with shoulder dart and waist dart, front with bust dart and waist dart, neckline and armhole curves. The source of the drafting method is stated.
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
- **New measurement `armhole_depth`** ("Ärmhålsdjup", nape straight down to a level ruler under
  both armpits), added to the catalogue per ADR 0005. The profile has 18 measurements; existing
  profiles lack it (not measured) and existing skirt projects are unaffected.
- **Bust dart from `front_length`:** the front neck point is placed so that neck point, bust point
  and waist add up to `front_length`. The dart is the rotation about the bust point that brings the
  front shoulder point level with the back shoulder point. Needs `bust_height` and `bust_distance`.
- **Ease defaults:** bust 80 mm, waist 40 mm, armhole depth 10 mm. These and the draft constants are
  parameters, not yet checked against the book.
- **Armhole length:** exposed as formula values `armhole_length`, `back_armhole_length` and
  `front_armhole_length` in the evaluation result (`length(curve)`, ADR 0004 decision 8). No engine
  change; the sleeve (0007) reads them.
- **Measurement definitions in tests:** the bust line is the horizontal line through the underarm
  points, net of any dart it crosses; the waist is the sum of the waist seam segments (dart legs
  excluded); a shoulder seam is the sum of its two segments (dart closed).
- **Block select:** with two blocks nothing is preselected; the select has the prompt
  "Choose a block".
