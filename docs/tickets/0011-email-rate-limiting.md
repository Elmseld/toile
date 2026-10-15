---
id: 0011
title: Rate limiting for outgoing email
status: todo
type: feature
---

## Background
The security review of 0001 (finding S3) showed that nothing limits how often the app sends email.
Someone can submit forms over and over with another person's address and flood that person's inbox
with login links, confirmations and notifications. It also damages the sender domain's reputation.

## Desired behaviour
Every email flow (login link, confirmation on registration, notification about a registration
attempt, email change, and notification about a change attempt) has a limit per recipient address
and per IP address. Over the limit no email is sent, but the response to the user is the same. The
limit must not reveal whether an address has an account.

## Acceptance criteria
- [ ] At most 3 emails per recipient address and flow within 15 minutes, and at most 20 emails sent per IP address per hour. The values can be changed in the configuration.
- [ ] Over the limit no email is sent, but the user gets the same flash and redirect as otherwise.
- [ ] The limits also apply to addresses that have no account.
- [ ] Events over the limit are logged at info level without logging the full email address.
- [ ] Tests for each flow: under the limit email is sent, over the limit it is not, and the response is identical.
- [ ] The technology decision (e.g. Hammer with ETS or a custom table in Postgres) is documented in an ADR.

## Out of scope
- CAPTCHA.
- Rate limiting of password login attempts.

## Notes
The app runs on a single node for now, so ETS is enough unless we need shared counting across nodes.
