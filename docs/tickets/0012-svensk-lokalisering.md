---
id: 0012
title: Svensk lokalisering av valideringsfel och systemtexter
status: todo
type: chore
---

## Bakgrund
I 0001 översattes inloggningssidor, flash-meddelanden och mejl till svenska. Ecto-valideringar
("can't be blank", "has invalid format") och några systemtexter i `core_components` och
`flash_group` ("We can't find the internet", "close", "Actions") är fortfarande på engelska.

## Önskat beteende
Hela gränssnittet är på svenska. Texterna går via gettext med svenska som standardspråk.

## Acceptanskriterier
- [ ] Gettext har svenska (`sv`) som standardspråk, och `priv/gettext/sv/LC_MESSAGES/` har `default.po` och `errors.po`.
- [ ] Alla Ecto-valideringsfel som används i appen visas på svenska, inklusive pluralformer (t.ex. "ska vara minst 12 tecken").
- [ ] Texterna i `core_components.ex` och `layouts.ex` (flash_group, theme toggle) är på svenska.
- [ ] Svenska texter som hårdkodats i 0001 flyttas till gettext så att allt användarsynligt går samma väg.
- [ ] Testerna kontrollerar svenska valideringsfel i registrering och inställningar.
- [ ] CI kontrollerar att `mix gettext.extract --check-up-to-date` inte hittar nya oöversatta texter.

## Utanför scope
- Fler språk än svenska, och språkväljare.
