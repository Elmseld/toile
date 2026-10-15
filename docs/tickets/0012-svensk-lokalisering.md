---
id: 0012
title: Engelska texter i koden via gettext, svenska som grundspråk
status: todo
type: chore
---

## Bakgrund
I 0001 skrevs användarsynliga texter direkt på svenska i koden: sidor, flash-meddelanden och mejl.
Samtidigt är Ecto-valideringsfel ("can't be blank", "should be at least 12 character(s)") och några
systemtexter i `core_components` och `flash_group` ("We can't find the internet", "close",
"Actions") fortfarande på engelska. Gränssnittet blandar alltså språk, och svenskan är hårdkodad
så att den inte går att översätta.

## Önskat beteende
All användarsynlig text i koden skrivs på engelska och går via gettext, så att engelska är
källspråket (msgid). Svenska översättningar ligger i `priv/gettext/sv/`. Appen är konfigurerad med
svenska (`sv`) som grundspråk, så att användaren ser svenska överallt, precis som i dag. Att lägga
till fler språk senare ska bara kräva nya `.po`-filer.

## Acceptanskriterier
- [ ] Alla användarsynliga texter i `lib/` skrivs på engelska och går via `gettext`, `ngettext` eller `dgettext` (med `ToileWeb.Gettext`). Ingen svensk text finns hårdkodad i koden. Det gäller sidor, komponenter, flash-meddelanden, sidtitlar, mejl (ämne och innehåll), aria-etiketter och felmeddelanden.
- [ ] Grundspråket ställs in i konfigurationen: `config :toile, ToileWeb.Gettext, default_locale: "sv"` (eller motsvarande), och det används för både webbförfrågningar och mejl.
- [ ] `priv/gettext/sv/LC_MESSAGES/default.po` och `errors.po` innehåller svenska översättningar av alla texter, inklusive Ecto-valideringsfel med rätta pluralformer (t.ex. "ska vara minst 12 tecken").
- [ ] Texterna i `core_components.ex` och `layouts.ex` (flash_group, theme toggle) går via gettext och visas på svenska.
- [ ] Det som visas för användaren är oförändrat jämfört med i dag (samma svenska texter som 0001 införde), förutom att valideringsfel och systemtexter nu också är på svenska.
- [ ] Tester som kontrollerar text gör det mot den svenska översättningen, eftersom testmiljön använder samma grundspråk. Minst ett test bekräftar att svenska valideringsfel visas i registrering och inställningar, och ett test bekräftar att ett mejl skickas på svenska.
- [ ] CI kör `mix gettext.extract --check-up-to-date` och felar om texter i koden saknas i `.pot`-filerna. En kontroll (t.ex. ett test eller skript) felar om en text i `sv`-filerna saknar översättning.
- [ ] `CLAUDE.md` beskriver konventionen: skriv texter på engelska i koden via gettext, lägg till svensk översättning i `priv/gettext/sv/`, och kör `mix gettext.extract --merge`.

## Utanför scope
- Språkväljare, språk per användare eller språk från webbläsaren (`Accept-Language`).
- Fler språk än svenska. Engelska fungerar automatiskt som källspråk men behöver inte exponeras.
- Översättning av dokumentation och tickets.

## Anteckningar
- Mejl skickas utanför webbförfrågan. Se till att rätt språk är satt där (t.ex. `Gettext.put_locale/2` eller `Gettext.with_locale/3` i `UserNotifier`), så att mejl inte faller tillbaka på engelska.
- 0001 har tester som kontrollerar svenska texter ordagrant. De ska fortsätta gå igenom utan att testet ändras, om texten inte ändras.
