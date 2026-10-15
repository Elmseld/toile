---
id: 0014
title: Run the whole development environment in Docker
status: in-review
type: chore
---

## Background
Today only Postgres runs in Docker. Elixir, Erlang and Bun are installed locally on the machine. This
has already caused version drift: locally we ran Elixir 1.20.4 and OTP 29.1.2 while `.tool-versions`
and CI were on 1.20.3 and 29.0.5, and Hex was built for the wrong OTP version. The developer's other
projects run the app in Docker, so the same workflow here makes it easier to switch between projects
and to set up the environment on a new machine.

Runs after 0013, so that the Docker image is built with the upgraded versions.

## Desired behaviour
`docker compose up` starts both the database and the app on localhost:4000 with code reloading.
Tests, checks and engine commands run in the container. No Elixir, Erlang or Bun needs to be
installed on the machine, and the versions in Docker are the same as in CI.

## Acceptance criteria
- [x] A development `Dockerfile` (or a `dev` target) with the Erlang, Elixir and Bun versions listed in `.tool-versions`. There is a single source for the versions, or a CI check that fails if the Dockerfile and `.tool-versions` disagree.
- [x] `compose.yaml` has an `app` service that depends on `db` (healthcheck). It mounts the code and runs `mix setup` when needed, then `mix phx.server` on port 4000. `deps`, `_build`, `engine/node_modules` and the Hex/Mix cache live in named volumes so that restarts are fast.
- [x] Database settings come from environment variables (e.g. `DATABASE_HOST`, default `localhost`), so that the app reaches `db` in Docker and `localhost` in CI. `config/dev.exs` and `config/test.exs` read them.
- [x] Code reloading works when a file changes on the host (LiveView and CSS/JS watchers). This is verified manually and noted in the PR.
- [x] Tests and checks can be run in the container: `docker compose exec app mix precommit` and `docker compose exec app sh -c "cd engine && bun run typecheck && bun test"`, or an equivalent alias/script.
- [x] `CLAUDE.md` describes all commands via Docker, since the agents in `/ship` read the check commands from there. `README.md` describes starting, testing, `iex` (`docker compose exec app iex -S mix`) and how to clear volumes.
- [x] `.claude/launch.json` starts the app via `docker compose up`, and `.claude/smoke-test.md` matches the new way of starting.
- [x] CI passes, with the same versions as the Docker image. CI may keep using setup-beam if the versions are guaranteed to be identical.
- [x] `/smoke-test` passes with the app in Docker.

## Out of scope
- A production image and deployment.
- Switching CI to build and run the Docker image, unless needed to keep the versions in sync.

## Notes
- Base image: the official `hexpm/elixir` images with the right Elixir/OTP combination, plus Bun. Do not use Naymspace's internal images, since this is a private project on GitHub.
- On macOS, file syncing can make compilation slower. Measure the time for `mix test` locally versus in Docker and note it in the PR.
- Run the container as a non-root user or with the right uid, so that files created in the mounted code (e.g. migrations from generators) do not end up owned by root on the host.
