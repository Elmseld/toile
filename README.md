# Toile

An app for drafting and developing sewing patterns. Start from parametric base blocks
(bodice, skirt, sleeve), fit them to your measurements, then modify and print them.

- `lib/`: Phoenix/LiveView app (accounts, measurements, pattern storage)
- `engine/`: pattern engine in TypeScript, from measurements and pattern definition to geometry ([README](engine/README.md))

## Development

```bash
docker compose up -d
mix setup
mix phx.server
```

Then open [localhost:4000](http://localhost:4000).

Tests: `mix test` for the app, `cd engine && bun test` for the engine.
