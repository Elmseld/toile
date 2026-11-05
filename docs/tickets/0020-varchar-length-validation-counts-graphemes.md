---
id: 0020
title: Name length validation counts graphemes, the varchar column counts codepoints
status: todo
type: bug
---

## Background
Found while shipping 0010. `validate_length/3` counts graphemes by default, but a Postgres
`varchar(100)` column counts codepoints. A string can therefore pass the changeset and still be
too long for the column.

## Evidence
`lib/toile/patterns/pattern_project.ex:75` and `:93` validate `name` with
`validate_length(:name, max: 100)`; the column is `add :name, :string, size: 100` in
`priv/repo/migrations/20261018184118_create_pattern_projects.exs`. A name of 100 decomposed
"é" (`e` + U+0301) is 100 graphemes but 200 codepoints:

```elixir
name = String.duplicate("é", 100)   # decomposed form: e followed by U+0301, repeated
```

The changeset is valid, then `Repo.insert` raises `Postgrex.Error` 22001
`string_data_right_truncation` instead of returning a changeset error (a 500 for the user).

Same pattern in other fields (grep of `validate_length` against the migrations):

- `lib/toile/measurements/measurement_profile.ex:34`: `name`, `max: 100`, column `varchar(100)`
  (`20261018143234_create_measurement_profiles.exs`). Affected.
- `lib/toile/patterns/pattern_project.ex:75`, `:93`: `name`, `max: 100`, column `varchar(100)`.
  Affected.
- `lib/toile/accounts/user.ex:42`: `email`, `max: 160`, but the column is `citext` with no
  length limit, so no truncation error. Not affected (the limit is only a policy).
- `lib/toile/accounts/user.ex:89`, `:106`: `password` is bounded by `max: 72` (bytes in the
  second call, which is correct for bcrypt); the stored hash has no user-controlled length. Not
  affected.
- `pattern_projects.block` is `varchar(100)` but has no `validate_length`; check that it is
  validated against the known block keys so it can never exceed the column.

## Desired behaviour
A value that does not fit the column is rejected by the changeset with a length error, never by
a database exception.

## Acceptance criteria
- [ ] `PatternProject` name validation counts codepoints (`validate_length(:name, max: 100, count: :codepoints)`) in both changesets.
- [ ] `MeasurementProfile` name validation counts codepoints.
- [ ] A test per schema: `String.duplicate("é", 100)` in decomposed form returns an invalid changeset with a "should be at most 100 character(s)" error on `name` and does not raise on insert; a 100-codepoint name is still accepted.
- [ ] `pattern_projects.block` is confirmed to be restricted to known block keys, or gets a length validation; the result is noted in the PR.
- [ ] Any other `varchar(n)` column found with a grapheme-counting validation is fixed or listed in a follow-up ticket.

## Out of scope
- Changing column sizes or normalising names to NFC.
