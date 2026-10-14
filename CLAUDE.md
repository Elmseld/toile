# Toile

Read `docs/product.md` for what the product is and its principles, and `AGENTS.md` for Phoenix 1.8 conventions.

## Layout
- `lib/`: Phoenix/LiveView app. Stores and validates pattern definitions but never computes geometry.
- `engine/`: pattern engine in TypeScript (Bun). Pure functions, no DOM, no I/O. All geometry lives here.
- `docs/tickets/`: work items for `/ship`. `docs/adr/`: architecture decisions.

## Running things
- Database: `docker compose up -d` (Postgres 17 on localhost:5432).
- App checks: `mix precommit` (compile with warnings as errors, unused deps, format, test).
- Engine checks: `cd engine && bun run typecheck && bun test`.
- Dev server: `mix phx.server` on localhost:4000.

CI (`.github/workflows/ci.yml`) runs both sets of checks. Tool versions are pinned in `.tool-versions`.

## Conventions
- Lengths are millimeters everywhere in code and storage. Only the UI shows centimeters.
- Coordinates follow SVG: origin top left, y down.
- User-owned data (measurement profiles, pattern projects) is always scoped to the current user. Follow `docs/adr/0001-scope-per-anvandare.md` (context functions take `%Toile.Accounts.Scope{}` first; generate with `mix phx.gen.live`). Routes for such data go in the `:require_authenticated_user` live_session in `lib/toile_web/router.ex`.
