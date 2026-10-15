---
id: 0012
title: English source strings in code via gettext, Swedish as the default locale
status: in-review
type: chore
---

## Background
In 0001, user-facing text was written directly in Swedish in the code: pages, flash messages and
emails. Meanwhile, Ecto validation errors ("can't be blank", "should be at least 12 character(s)")
and some system texts in `core_components` and `flash_group` ("We can't find the internet", "close",
"Actions") are still in English. The UI therefore mixes languages, and the Swedish is hardcoded so
that it cannot be translated.

## Desired behaviour
All user-facing text in the code is written in English and goes through gettext, so that English is
the source language (msgid). Swedish translations live in `priv/gettext/sv/`. The app is configured
with Swedish (`sv`) as the default locale, so the user sees Swedish everywhere, just as today.
Adding more languages later should only require new `.po` files.

## Acceptance criteria
- [x] All user-facing text in `lib/` is written in English and goes through `gettext`, `ngettext` or `dgettext` (with `ToileWeb.Gettext`). No Swedish text is hardcoded in the code. This covers pages, components, flash messages, page titles, emails (subject and body), aria labels and error messages.
- [x] The default locale is set in the configuration: `config :toile, ToileWeb.Gettext, default_locale: "sv"` (or equivalent), and it is used for both web requests and emails.
- [x] `priv/gettext/sv/LC_MESSAGES/default.po` and `errors.po` contain Swedish translations of all texts, including Ecto validation errors with correct plural forms (e.g. "ska vara minst 12 tecken").
- [x] The texts in `core_components.ex` and `layouts.ex` (flash_group, theme toggle) go through gettext and are shown in Swedish.
- [x] What is shown to the user is unchanged compared to today (the same Swedish texts that 0001 introduced), except that validation errors and system texts are now also in Swedish.
- [ ] The test environment uses `en` as its default locale (`config/test.exs`), so tests assert English msgids. Tests that only check language or translation are removed; behavioural tests keep their assertions in English. At least one test confirms that emails use the configured default locale regardless of the caller's process locale. Translation completeness for `sv` is guarded by `test/toile_web/gettext_test.exs`.
- [x] CI runs `mix gettext.extract --check-up-to-date` and fails if texts in the code are missing from the `.pot` files. A check (e.g. a test or script) fails if a text in the `sv` files lacks a translation.
- [x] `CLAUDE.md` describes the convention: write texts in English in the code via gettext, add the Swedish translation in `priv/gettext/sv/`, and run `mix gettext.extract --merge`.

## Out of scope
- Language picker, per-user language or language from the browser (`Accept-Language`).
- More languages than Swedish. English works automatically as the source language but does not need to be exposed.
- Translation of documentation and tickets.

## Notes
- Emails are sent outside the web request. Make sure the right locale is set there (e.g. `Gettext.put_locale/2` or `Gettext.with_locale/3` in `UserNotifier`), so that emails do not fall back to English.
- 0001 has tests that check Swedish texts verbatim. They are converted to assert the English msgid, because the test environment uses `en`; production and dev keep `sv`.
