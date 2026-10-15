---
id: 0001
title: User accounts and login
status: in-review
type: feature
---

## Background
Measurement profiles and pattern projects are personal and must be tied to an account.

## Desired behaviour
Users can register, log in and out, and reset their password. Logged-in users land on an empty
start page ("Mina mönster", i.e. "My patterns"), which later tickets fill in.

## Acceptance criteria
- [x] Registration, login, logout and password reset work (the standard Phoenix generator `phx.gen.auth` is fine).
- [x] Pages for measurement profiles and patterns require login. Logged-out users are redirected to the login page.
- [x] There is an established pattern for scoping resources per user, so that later tickets can follow it.
- [x] The start page shows "Mina mönster" for logged-in users and a short description of Toile for logged-out users.

## Out of scope
- Social login, organisations and roles.

## Notes
In dev, email goes to the local Swoosh mailbox. No real email provider is needed yet.
