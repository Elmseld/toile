---
id: 0002
title: Mönstermotor – formler, mått och parametrar
status: todo
type: feature
---

## Bakgrund
Allt i ett parametriskt mönster beror på formler som `waist / 4 + ease_waist`. Motorn behöver
kunna tolka och räkna ut sådana formler säkert innan geometrin byggs ovanpå (se `docs/product.md`).

## Önskat beteende
Motorn (`engine/`) kan ta en uppsättning mått, parametrar och namngivna formler och räkna ut
alla värden, i rätt beroendeordning, med begripliga fel.

## Acceptanskriterier
- [ ] Formelspråk med tal, `+ - * /`, parenteser, unärt minus och referenser till mått och parametrar.
- [ ] Minst funktionerna `sqrt`, `min`, `max`, `abs`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan2`, `rad`, `deg`.
- [ ] Formler kan referera till andra formler. Beroenden räknas i rätt ordning oavsett deklarationsordning.
- [ ] Cykliska beroenden ger ett tydligt fel som namnger cykeln.
- [ ] Okänd referens, syntaxfel och division med noll ger fel med position och namn, inget undantag som kraschar.
- [ ] Formler tolkas utan `eval`/`Function` (egen parser).
- [ ] Allt är rena funktioner med enhetstester (`bun test`) och strikt typning (`bun run typecheck`).

## Utanför scope
- Geometri (punkter, kurvor). Det kommer i 0003.
- UI.

## Anteckningar
Längder i millimeter. Vinklar i grader utåt i API:t, `rad()`/`deg()` för konvertering.
