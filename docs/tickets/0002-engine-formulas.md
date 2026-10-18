---
id: 0002
title: Pattern engine - formulas, measurements and parameters
status: in-progress
type: feature
---

## Background
Everything in a parametric pattern depends on formulas such as `waist / 4 + ease_waist`. The engine
must be able to parse and evaluate such formulas safely before the geometry is built on top of
them (see `docs/product.md`).

## Desired behaviour
The engine (`engine/`) can take a set of measurements, parameters and named formulas and evaluate
all values, in the correct dependency order, with understandable errors.

## Acceptance criteria
- [ ] A formula language with numbers, `+ - * /`, parentheses, unary minus and references to measurements and parameters.
- [ ] At least the functions `sqrt`, `min`, `max`, `abs`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan2`, `rad`, `deg`.
- [ ] Formulas can reference other formulas. Dependencies are evaluated in the correct order regardless of declaration order.
- [ ] Circular dependencies produce a clear error that names the cycle.
- [ ] Unknown references, syntax errors and division by zero produce errors with position and name, not a crashing exception.
- [ ] Formulas are interpreted without `eval`/`Function` (a custom parser).
- [ ] Everything is pure functions with unit tests (`bun test`) and strict typing (`bun run typecheck`).

## Out of scope
- Geometry (points, curves). That comes in 0003.
- UI.

## Notes
Lengths are in millimetres. Angles are in degrees at the API boundary, with `rad()`/`deg()` for conversion.
