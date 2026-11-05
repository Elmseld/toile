---
id: 0025
title: Registration and email change response time reveals whether an address is taken
status: todo
type: bug
---

## Background
Found while checking registration and email change in ticket 0016 (login links now send in a
background task, ADR 0010). Both flows still deliver synchronously in the request, and ADR 0002 §1
requires that nothing reveals whether an address has an account.

- **Registration** (`Accounts.register_user_and_deliver_instructions/4`). A free address costs a
  user insert, a hit on `:registration_confirmation`, a token insert and one send. A taken address
  costs a failed `unsafe_validate_unique`, an owner lookup, a hit on `:registration_attempt_notice`
  and one send. A single request under the limit differs little, but the rate-limit sequence does:
  for a free address, requests 1-4 send (one confirmation, then three notices to the new account)
  and the 5th is denied; for a taken address, requests 1-3 send and the 4th is denied. The 4th
  request is fast for a taken address and slow (one mail delivery) for a free one, a clear oracle
  with a real mailer.
- **Email change** (`Accounts.request_user_email_change/4`, needs a logged-in user in sudo mode). A
  free address costs a hit on `:email_change_link`, a token insert and a send. A taken address costs
  an owner lookup, a hit on `:email_change_attempt_notice` and a send. Both buckets fill after 3, so
  the pattern is the same; only the token insert versus select and the mail size differ. Lower
  severity.

## Desired behaviour
The time to answer a registration or email-change request does not depend on whether the address is
taken.

## Acceptance criteria
- [ ] The sends for `:registration_confirmation`, `:registration_attempt_notice`,
      `:email_change_link` and `:email_change_attempt_notice` run under
      `Toile.Accounts.EmailDeliverySupervisor` after the rate-limit hit, using the pattern from
      ticket 0016 (a task is started for both outcomes; failures are logged with the masked address
      and failure class only).
- [ ] A timing test with `Toile.SlowMailAdapter` for each form: the reply for a taken address and for
      a free one does not wait on the mailer and differs by less than a small tolerance, including
      the 4th registration request.
- [ ] The same flash, redirect and return value for free and taken addresses (no regression of 0002
      and 0011); existing tests only change to wait for the background delivery.
- [ ] The email is still sent exactly once per allowed request.

## Out of scope
- Constant-time padding of unrelated endpoints.
- CAPTCHA.

## Notes
- The user insert in registration stays in the request: the taken/new decision needs it.
- The email-change token should be issued under `lock_user/1` (see the Deferred entry in ADR 0002).
- Tests that read emails, tokens or logs call `AccountsFixtures.await_email_deliveries/0`
  (ADR 0010).
