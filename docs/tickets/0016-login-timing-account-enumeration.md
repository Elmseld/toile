---
id: 0016
title: Login page response time reveals whether an account exists
status: todo
type: bug
---

## Background
Found while planning 0011 (finding B2). ADR 0002 §1 requires that nothing reveals whether an
address has an account. The login page shows the same flash and redirect for every address, but the
response time differs. In `lib/toile_web/live/user_live/login.ex`, `handle_event("submit_magic", ...)`
looks up the user and, only for a registered address, inserts a login token and sends the email
synchronously (`Accounts.request_login_instructions/3` after 0011, same cost profile). A registered
address therefore takes noticeably longer (token insert plus mailer call) than an unknown one.

## Evidence
Submit the magic-link form repeatedly with a known and an unknown address and compare the time to
the `submit_magic` reply. The known address is consistently slower by the cost of the insert and
the mail delivery; an attacker can use that to enumerate accounts. Rate limiting (0011) does not
change this: under the limit, the known address still takes the slow path.

## Desired behaviour
The time to answer a login-link request does not depend on whether the address has an account.

## Acceptance criteria
- [ ] The token insert and email delivery for a login link no longer run inside the request that answers the user (for example delivered by a background task), so known and unknown addresses take the same path before the reply.
- [ ] A test measures that the reply path does not wait on the mailer: with a mailer that sleeps (or a stub with a deliberate delay), the reply for a known address is not slower than for an unknown one beyond a small tolerance.
- [ ] The same flash and redirect are shown for known, unknown and rate-limited addresses (no regression of 0011).
- [ ] The email is still sent exactly once for a known address, and tokens are still created under the user lock (ADR 0002 §3). Failed deliveries are logged without the full address.
- [ ] Registration and email change are checked for the same timing difference (taken versus free address); if present, they are fixed or a follow-up ticket is written.
- [ ] ADR 0002 or 0010 records the chosen approach.

## Out of scope
- Constant-time padding of unrelated endpoints.
- CAPTCHA.

## Notes
- Async delivery is a design change (supervised `Task.Supervisor`, test setup that waits for the
  task), which is why this is split from 0011.
- Rate limiting looks the account up first and keys the recipient bucket on the stored address, and
  it makes exactly one hit for unknown addresses too (ADR 0010), so the IP budget is no oracle;
  keep that.
