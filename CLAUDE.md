# Toile

Read `docs/product.md` for what the product is and its principles, and `AGENTS.md` for Phoenix 1.8 conventions.

## Layout
- `lib/`: Phoenix/LiveView app. Stores and validates pattern definitions but never computes geometry.
- `engine/`: pattern engine in TypeScript (Bun). Pure functions, no DOM, no I/O. All geometry lives here.
- `docs/tickets/`: work items for `/ship`. `docs/adr/`: architecture decisions.

## Running things
Everything runs in Docker; no Erlang, Elixir or Bun is needed on the host.
- Start: `docker compose up` (Postgres and the app on localhost:4000, code reloading). Use `docker compose up -d` to run in the background.
- App checks: `docker compose exec app mix precommit` (compile with warnings as errors, unused deps, format, gettext extraction check, test). The extraction check runs in a separate VM (`cmd env MIX_ENV=test mix gettext.extract --check-up-to-date`) because extraction force-recompiles the app.
- Engine checks: `docker compose exec app sh -c "cd engine && bun run typecheck && bun test"`.
- Any mix task or generator: `docker compose exec app mix <task>`.
- If the app is not running, every `docker compose exec app <cmd>` above also works as `docker compose run --rm app <cmd>`.
- Versions: `.tool-versions` is the single source. The `Dockerfile` `ARG`s must match it; `bin/check-tool-versions` checks this in CI.

CI (`.github/workflows/ci.yml`) runs three jobs: the app checks (including `mix gettext.extract --check-up-to-date`), the engine checks, and `docker` (`bin/check-tool-versions`, then a build of the dev image).

## Conventions
- The /ship agents load the `elixir-genius` skill for Elixir idioms. When it conflicts with this file, `AGENTS.md` (Phoenix 1.8 conventions) or the ADRs, those win: keep the standard Phoenix layout (contexts under `lib/toile`, web layer under `lib/toile_web`), with no umbrella apps, path-based sub-projects or `impl/` layers unless an ADR introduces them.
- Language: everything another developer reads is in English: code, comments, commit messages, PRs, docs, ADRs, tickets and file names. Only the user-facing UI is Swedish. Quote Swedish UI text verbatim when a doc refers to it.
- UI text: write user-facing text in English in the code and run it through gettext with `ToileWeb.Gettext` (`gettext/1`; `pgettext/2` with a context for link fragments spliced into a sentence; `dgettext("errors", ...)` or `dgettext_noop` for validation messages). Never hardcode Swedish. After adding or changing text, run `docker compose exec app mix gettext.extract --merge` and add the Swedish `msgstr` in `priv/gettext/sv/LC_MESSAGES/` (`default.po` or `errors.po`). The default locale comes from the `DEFAULT_LOCALE` environment variable at runtime (`config/runtime.exs`, default `sv`; an empty value counts as unset; `compose.yaml` passes it through from the shell or `.env`). The test environment ignores it and is pinned to `en` (`config/test.exs`): tests assert English msgids and do not test translations. Emails use the app default, read at send time in `UserNotifier`, not the caller's process locale. Error pages (`ErrorHTML`) translate the common statuses and fall back to a translated generic message for any other status. `gettext.extract --check-up-to-date` (CI and `mix precommit`) fails on unextracted texts, and `test/toile_web/gettext_test.exs` fails on untranslated `sv` messages.
- Lengths are millimeters everywhere in code and storage. Only the UI shows centimeters.
- Coordinates follow SVG: origin top left, y down.
- User-owned data (measurement profiles, pattern projects) is always scoped to the current user. Follow `docs/adr/0001-per-user-scope.md` (context functions take `%Toile.Accounts.Scope{}` first; generate with `mix phx.gen.live`). Routes for such data go in the `:require_authenticated_user` live_session in `lib/toile_web/router.ex`. Only account settings use the separate `:require_sudo_mode` scope. Account-security rules (locking, tokens, no address enumeration): `docs/adr/0002-account-security.md`.
