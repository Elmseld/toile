---
id: 0030
title: Avoid :tmp_dir in the check-tool-versions test
status: todo
type: bug
---

## Background
Ticket 0017 fixed a flaky loader test by moving its fixtures out of ExUnit's `:tmp_dir`, which lives
inside the project (a Docker bind mount on macOS) at a fixed path that concurrent `mix test` runs on
the same checkout share and `rm_rf`. `test/bin/check_tool_versions_test.exs` also uses `:tmp_dir`,
writing files that a `sh` subprocess then reads, so it has the same exposure. It has not been seen
failing.

## Desired behaviour
The test is deterministic on the macOS Docker setup and when several `mix test` runs share a checkout.

## Acceptance criteria
- [ ] The test's fixtures live in a per-OS-process unique directory outside the bind mount.
- [ ] Consider moving the setup from `loader_test.exs` into a shared helper in `test/support/` (for example `unique_tmp_dir!/1`, registering cleanup with `on_exit`) used by both tests.
- [ ] The test passes 50 times in a row on macOS with Docker.
- [ ] `mix precommit` passes.

## Out of scope
- Changes to `bin/check-tool-versions` behaviour.
