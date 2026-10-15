---
id: 0006
title: Bodice block
status: todo
type: feature
---

## Background
The bodice block is the foundation for tops and dresses and the most complex block.

## Desired behaviour
The user can create a project from the block "Livstycke" (Bodice) with front and back pieces,
computed from the measurement profile.

## Acceptance criteria
- [ ] The block "Livstycke" as a pattern definition: back with shoulder dart and waist dart, front with bust dart and waist dart, neckline and armhole curves. The source of the drafting method is stated.
- [ ] Ease at bust, waist and armhole depth are parameters.
- [ ] The armhole length (front + back) is exposed as a measurable value, so that the sleeve (0007) can use it.
- [ ] Engine tests verify that the bust and waist circumference of the finished pattern equal measurement + ease within 2 mm, and that the front and back shoulder seams are equally long (± 1 mm, including any shoulder dart).
- [ ] Can be selected under "Nytt mönster".

## Out of scope
- Princess seams, dart manipulation and other design changes.

## Notes
Builds on the engine (0002, 0003) and the project view (0005).
