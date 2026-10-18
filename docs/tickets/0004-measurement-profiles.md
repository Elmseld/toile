---
id: 0004
title: Measurement profiles
status: in-review
type: feature
---

## Background
All patterns are computed from measurements. Users need to be able to save measurements for
themselves and for others.

## Desired behaviour
Under "Mått" (Measurements) the user can create, name, edit and delete measurement profiles. Each
measurement has an explanation of how to take it.

## Acceptance criteria
- [x] CRUD for measurement profiles, scoped to the logged-in user. Other users' profiles cannot be viewed or changed.
- [x] A fixed list of measurements sufficient for bodice, skirt and sleeve, at least: bust circumference, waist circumference, hip circumference, neck circumference, shoulder width, back width, chest width, back length, front length, bust height, bust distance, hip height, skirt length, arm length, upper arm circumference, wrist circumference, height.
- [x] Each measurement has a Swedish label and a short help text on how to take it.
- [x] Measurements are entered in cm with one decimal and stored in mm. Implausible values (negative, zero, over 300 cm) are rejected.
- [x] Incomplete profiles can be saved. It is visible which measurements are missing.
- [x] Works with touch on a tablet (large fields, numeric keyboard).

## Out of scope
- Images and illustrations for the measurements (text is enough for now).
- Custom, user-defined measurements.

## Notes
The measurement keys (e.g. `waist`) are the same names the formulas in the engine refer to.
Define the list in one place that both Elixir and the engine's blocks can rely on.
