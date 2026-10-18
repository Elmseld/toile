# 0005: Measurement keys

Status: accepted (ticket 0004)

## Context
Measurement profiles (Phoenix, stored per user) and pattern blocks (engine formulas) must agree on
the names of the body measurements: a block that uses `waist` only works if every profile can hold
`waist`. The list is fixed (no user-defined measurements yet) and every block's `measurements`
list depends on it, so it must be defined in one place that both Elixir and TypeScript can rely on.
Keys also have to be valid formula identifiers (ADR 0003), so they are snake_case.

## Decision
- The keys live in one file, `engine/src/measurements.json`: a JSON array of key strings in display
  order. It holds nothing else: no labels (UI text must be gettext literals so extraction and the
  translation test cover it) and no limits (plausibility is the app's rule).
- The file sits in `engine/src/` so the engine stays self-contained. The engine imports it
  statically (`MEASUREMENT_KEYS`, `isMeasurementKey` in `engine/src/measurements.ts`; no I/O).
  The Phoenix app reads it at compile time in `Toile.Measurements.Catalog`
  (`@external_resource` plus `JSON.decode!/1`), so editing the file recompiles dependents.
- Both sides validate the file: non-empty, unique, each key matches `^[a-z][a-z0-9_]*$`. Elixir
  raises at compile time; the engine checks it in tests.
- Profiles store `measurements` as a jsonb map `{ "waist": 725, ... }` of integer millimetres.
  A key that is absent or `null` means "not measured". Ecto writes `null` for unset values, so
  readers must treat both the same, and the conversion to engine input (ticket 0005) drops nulls.
  There is no column per key.
- Labels and help texts per key are gettext literals in `ToileWeb.MeasurementTexts`, with no
  catch-all clause and a test over all keys, so a key without texts fails loudly.

## Alternatives rejected
- Keys duplicated in TypeScript and Elixir with a sync test: two sources of truth.
- Labels in the JSON with dynamic gettext: dynamic msgids escape extraction and the translation test.
- A generated file: adds a build step and a place for drift.
- One database column per key: every new key would need a migration.

## Consequences
- Renaming or removing a key is a breaking change for stored profiles and pattern definitions and
  needs a data migration.
- Adding a key needs no database migration, but needs texts (label, help, Swedish translation).
- `lib/` depends on `engine/src/measurements.json` at compile time. Any release image must include
  that file when compiling the app.
- The engine does not reject unknown measurement names in definitions; blocks are expected to use
  catalogue keys.
