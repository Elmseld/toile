---
id: 0013
title: Upgrade Elixir and dependencies
status: in-progress
type: chore
---

## Background
The project was created with an older `phx_new` archive. The requirements in `mix.exs` therefore do
not match what we actually run, and some dependencies are one minor version behind:

- `mix.exs` requires `elixir: "~> 1.15"`, but we run 1.20.3 and 1.20.4 exists.
- `phoenix_live_view` 1.1.33 (`~> 1.1.0`), latest is 1.2.12.
- `phoenix_live_dashboard` 0.8.7 (`~> 0.8.3`), latest is 0.9.1.
- `dns_cluster` 0.2.0 (`~> 0.2.0`), latest is 0.3.1.
- `{:phoenix, "~> 1.8.5"}` is already locked to 1.8.15, but the requirement should reflect that.

It is cheaper to upgrade now, before the editor and the JS hooks (0005, 0008) are built on top of LiveView.

## Desired behaviour
The app runs the latest Elixir patch and the latest versions of the dependencies above, and the
requirements in `mix.exs` and `.tool-versions` match what is used locally and in CI. No user-visible
behaviour changes.

## Acceptance criteria
- [ ] `.tool-versions` specifies Elixir 1.20.4 (and the latest Erlang 29 patch if a newer one exists). CI uses the same versions.
- [ ] `mix.exs` requires `elixir: "~> 1.20"` and `{:phoenix, "~> 1.8.15"}`.
- [ ] `phoenix_live_view` is upgraded to 1.2.x, `phoenix_live_dashboard` to 0.9.x and `dns_cluster` to 0.3.x. `mix hex.outdated` shows no dependencies where "Update not possible" is caused by our own requirements.
- [ ] Breaking changes and deprecations in LiveView 1.2, LiveDashboard 0.9 and dns_cluster 0.3 have been reviewed according to their changelogs and handled. The `phoenix_live_view` JS package in assets follows the same version.
- [ ] `mix precommit` passes without warnings (no new deprecation warnings), and the engine checks pass.
- [ ] The account features from 0001 (registration, login, settings, logout) work in the browser after the upgrade.
- [ ] The README mentions how to install the right tool versions (e.g. `asdf install` or `mise install` based on `.tool-versions`).

## Out of scope
- New features, or starting to use new LiveView 1.2 APIs beyond what is required.
- Upgrading Phoenix to 1.9 or Postgres to a new major version.

## Notes
Run after the PR for 0001 is merged. Remember to update the local generator archive too:
`mix archive.install hex phx_new` (does not affect the project, but future projects).
