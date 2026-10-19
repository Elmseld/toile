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
- **New measurement `armhole_depth`** ("Ärmhålsdjup", nape straight down to a level ruler under
  both armpits), added to the catalogue per ADR 0005. The profile has 18 measurements; existing
  profiles lack it (not measured) and existing skirt projects are unaffected.
- **Bust dart from `front_length`:** the front neck point is placed so that neck point, bust point
  and waist add up to `front_length`. The dart is the rotation about the bust point that brings the
  front shoulder point level with the back shoulder point. Needs `bust_height` and `bust_distance`.
- **Bust dart cap and sensitivity:** the dart width at the shoulder grows by about 2 mm per mm of
  `front_length`, so a large figure (bust 1200 mm, `front_length` 80 mm over `back_length`) would
  get a 23 degree dart, 120 mm wide on a 135 mm shoulder. The angle is therefore capped by the
  parameter `max_bust_dart_angle` (15 degrees, a draft constant, not from the book); the uncapped
  value stays visible as `bust_dart_balance_angle`. Above the cap the front shoulder point lies
  higher than the back one; seam lengths, bust and waist are unaffected, so the AC tests hold
  (a large measurement set is in the tests, with a plausibility bound on the dart width). The rest
  of the balance makes the front armhole deeper and longer than the back one, so it gapes once
  sewn and `front_armhole_length` and `armhole_length` grow (large set: front 327 mm against back
  288 mm); moving the rest into a second dart is dart manipulation, out of scope. The dart
  is zero, without an error, when the front neck point lies no higher than the back neck point,
  e.g. for the size 12 test set when `front_length` is at most about 21 mm over `back_length`.
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
