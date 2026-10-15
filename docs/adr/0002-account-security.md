# 0002: Account security

Status: accepted (ticket 0001)

## Context
The account flow is built on `phx.gen.auth` (see ADR 0001). The security and code review found gaps
in the default code: accounts could be enumerated, concurrent requests could reuse one-time links,
and sessions could survive a password change.

## Decision
1. **No enumeration.** `Accounts.register_user_and_deliver_instructions/3` and
   `Accounts.request_user_email_change/3` give the same result (`{:ok, email}`, same flash and
   redirect) for free and taken addresses. If the address is taken, the account owner gets a
   notice email (`UserNotifier`) and no change link is sent. Other validation errors are shown as usual.
2. **Sudo mode for settings.** `/users/settings*` lives in its own scope and live_session
   `:require_sudo_mode` (the plug checks on the HTTP request so the path is saved and the user
   returns after logging in again). User-owned resources stay in `:require_authenticated_user`.
3. **The user row is locked.** Everything that changes a user and their tokens (magic link login,
   email change, password change, session token creation) runs in a transaction that first takes
   `SELECT ... FOR UPDATE` on the user row (`lock_user/1`) and then touches tokens. The same lock
   order everywhere (user row, then tokens) rules out deadlocks. The token is re-read after the
   lock, so a one-time link can only be redeemed once and a stale email link cannot overwrite an
   already completed change.
4. **Session tokens can be refused.** `generate_user_session_token/1` returns `{:ok, token}` or
   `{:error, :credentials_changed}` if the password hash changed since authentication. No session is
   created then, so a login in progress during a password change does not survive it.
5. **Replaced browser tokens are revoked.** On a new login, the browser's previous session token is
   deleted after the new one is created (`UserAuth.log_in_user/3`), so old tokens do not linger.
6. Passwords over 72 bytes are rejected with a validation error before bcrypt runs.

## Consequences
- New flows that change users or tokens must take `lock_user/1` first.
- Notice emails mean emails can be sent to addresses without any account action; this is intentional.

## Deferred
- **Email rate limiting** (finding S3): there is no limit on sent emails. Ticket 0011.
- **Change-email token during a concurrent password change:** a change link whose insert waited on
  the user lock can be created after the password change and is then not revoked. The fix would be
  a hash check at issuance. Not scheduled; raise it if email change is hardened.
