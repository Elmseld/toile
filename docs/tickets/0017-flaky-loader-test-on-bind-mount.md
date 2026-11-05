---
id: 0017
title: Flaky loader test on the Docker bind mount
status: done
type: bug
---

## Background
`test/toile/patterns/blocks/loader_test.exs:48` failed once in about 15 full runs with
`JSON.DecodeError unexpected end of JSON binary at position 0`. The test reads a file that
`File.write!` had just written in the test's `tmp_dir`. It did not reproduce later. Suspected cause:
read-after-write on the macOS Docker bind mount, where `tmp_dir` lives inside the project.
A second plausible cause: concurrent `mix test` runs on the same checkout share ExUnit's fixed
`:tmp_dir` path, and ExUnit `rm_rf`s it at test start, so one run can delete or truncate another's
file. Moving the fixtures to a per-OS-process unique directory outside the bind mount covers both
causes.

## Desired behaviour
The test is deterministic on the macOS Docker setup.

## Acceptance criteria
- [x] The test's temporary files are not on the bind mount (for example under `System.tmp_dir!/0`), or the content is passed to the loader directly without a file.
- [x] The test passes 50 times in a row (`for i in $(seq 50); do mix test test/toile/patterns/blocks/loader_test.exs; done`) on macOS with Docker.
- [x] `mix precommit` passes.

## Out of scope
- Changes to the loader's behaviour.
