# Toile

An app for drafting and developing sewing patterns. Start from parametric base blocks
(bodice, skirt, sleeve), fit them to your measurements, then modify and print them.

- `lib/`: Phoenix/LiveView app (accounts, measurements, pattern storage)
- `engine/`: pattern engine in TypeScript, from measurements and pattern definition to geometry ([README](engine/README.md))

## Development

Tool versions (Erlang, Elixir, Bun) are pinned in `.tool-versions`, and CI reads the same file.
From the repo root, install them with `asdf install` or `mise install`. Alternatively, check that
Homebrew's `erlang` and `elixir` match the pinned versions. After an Erlang/OTP change, run
`mix local.hex --force` and `mix deps.clean --all && rm -rf _build` before `mix setup`.

```bash
docker compose up -d
mix setup
mix phx.server
```

Then open [localhost:4000](http://localhost:4000). `mix setup` also runs the auth migrations.
Emails sent in dev (registration, login links) land in the local Swoosh mailbox at
[localhost:4000/dev/mailbox](http://localhost:4000/dev/mailbox).

Tests: `mix test` for the app, `cd engine && bun test` for the engine.
