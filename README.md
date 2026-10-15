# Toile

An app for drafting and developing sewing patterns. Start from parametric base blocks
(bodice, skirt, sleeve), fit them to your measurements, then modify and print them.

- `lib/`: Phoenix/LiveView app (accounts, measurements, pattern storage)
- `engine/`: pattern engine in TypeScript, from measurements and pattern definition to geometry ([README](engine/README.md))

## Development

The whole environment runs in Docker. Docker is the only prerequisite: no Erlang, Elixir or Bun
needs to be installed. `.tool-versions` is the single source for tool versions. The `Dockerfile`
`ARG`s must match it, and `bin/check-tool-versions` checks this in CI.

```bash
docker compose up
```

This starts Postgres and the Phoenix app (`mix setup`, then `mix phx.server`) with code reloading.
The first boot compiles all deps and can take a few minutes. Then open
[localhost:4000](http://localhost:4000). It is published on `127.0.0.1` only. Emails sent in dev
(registration, login links) land in the local Swoosh mailbox at
[localhost:4000/dev/mailbox](http://localhost:4000/dev/mailbox).

Tests and checks, with the app running:

```bash
docker compose exec app mix precommit
docker compose exec app sh -c "cd engine && bun run typecheck && bun test"
```

Any other mix task or generator: `docker compose exec app mix <task>`, or
`docker compose run --rm app mix <task>` when the app is not running.

IEx: `docker compose exec app iex -S mix` gives a shell without the server. To get IEx with the
server, stop the app and run `docker compose run --rm --service-ports app iex -S mix phx.server`.

On Linux, put `UID=<your uid>` and `GID=<your gid>` in `.env` (git-ignored) before building, so that
files created in the mounted code are owned by you. On Docker Desktop for macOS this is not needed.

Deps, `_build`, `engine/node_modules` and the Hex cache live in named volumes (`toile_deps`,
`toile_build`, `toile_engine_node_modules`, `toile_hex`), so restarts are fast.

- `docker compose down -v` removes all volumes, including the database.
- `docker compose down && docker volume rm toile_deps toile_build` keeps the database.
- After a change to `.tool-versions`: update the `Dockerfile` `ARG`s, run `docker compose build`,
  and remove `toile_build` and `toile_deps`.
