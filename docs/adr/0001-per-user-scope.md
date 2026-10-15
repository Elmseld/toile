# 0001: Per-user scope

Status: accepted (ticket 0001)

## Context
Measurement profiles (0004) and pattern projects (0005) are private to each user. Without a shared
rule it is easy to forget a user filter and leak data between accounts. Phoenix 1.8's
`mix phx.gen.auth` generates `Toile.Accounts.Scope`, which carries the logged-in user through the
app. The ticket also adds the `bcrypt_elixir` dependency for password hashing.

## Decision
Accounts are created with `mix phx.gen.auth Accounts User users --live --hashing-lib bcrypt`.
`config :toile, :scopes` registers `user` as the default scope, so `mix phx.gen.live`,
`phx.gen.context` and `phx.gen.schema` generate scoped code. Every user-owned resource follows
these rules:

1. Context functions take `%Toile.Accounts.Scope{}` as the first argument: `list_x(scope)`,
   `get_x!(scope, id)`, `create_x(scope, attrs)`, `update_x(scope, x, attrs)`,
   `delete_x(scope, x)`, `change_x(scope, x, attrs)`.
2. Queries always filter on `user_id == ^scope.user.id`. `get_x!/2` uses
   `Repo.get_by!(X, id: id, user_id: scope.user.id)`, so another user's id raises
   `Ecto.NoResultsError` (404).
3. `user_id` is never in `cast/3`. It is set from the scope when the record is created. Update and
   delete check that `x.user_id == scope.user.id`.
4. Tables have `user_id references(:users, type: :binary_id, on_delete: :delete_all)` and an index
   on `user_id`.
5. PubSub topics are per user: `"user:#{scope.user.id}:x"`.
6. LiveViews get `socket.assigns.current_scope` from the live_session `:require_authenticated_user`
   and pass it on. They never read `user_id` from params. All pages for measurement profiles and
   patterns go in that live_session. Account settings (`/users/settings`) live in their own scope
   with `:require_sudo_mode` (recent login required); user-owned resources such as `/patterns` do
   not require sudo mode and stay in `:require_authenticated_user`.
7. Every resource has a test showing that another user's scope cannot list, fetch, update or
   delete it (`user_scope_fixture/0`).
8. New resources are started with `mix phx.gen.live ...`, which uses the default scope.

## Consequences
- Leakage between accounts becomes a structural error that tests catch, not something one has to
  remember.
- Context functions without a scope are not allowed for user-owned data.
- Password reset is Phoenix 1.8's standard flow: log in with an email link, then set a new password
  under "Inställningar" (Settings). A classic reset page is a possible follow-up ticket.
- Registration uses email only. The account is confirmed via a link and the password is set afterwards.
- Account security decisions (token handling, lock order, enumeration) are in
  `docs/adr/0002-account-security.md`.
