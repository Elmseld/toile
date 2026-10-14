---
id: 0011
title: Rate limiting för utskick av mejl
status: todo
type: feature
---

## Bakgrund
Säkerhetsgranskningen av 0001 (fynd S3) visade att inget begränsar hur ofta appen skickar mejl.
Någon kan skicka formulär om och om igen med en annan persons adress och fylla personens inkorg
med inloggningslänkar, bekräftelser och notiser. Det skadar också avsändardomänens rykte.

## Önskat beteende
Varje mejlflöde (inloggningslänk, bekräftelse vid registrering, notis om registreringsförsök,
byte av e-post och notis om bytesförsök) har en gräns per mottagaradress och per IP-adress.
Över gränsen skickas inget mejl, men svaret till användaren är detsamma. Gränsen får inte
avslöja om en adress har ett konto.

## Acceptanskriterier
- [ ] Högst 3 mejl per mottagaradress och flöde inom 15 minuter, och högst 20 mejlutskick per IP-adress och timme. Värdena går att ändra i konfigurationen.
- [ ] Över gränsen skickas inget mejl, men användaren får samma flash och redirect som annars.
- [ ] Gränserna gäller även för adresser som inte har något konto.
- [ ] Händelser över gränsen loggas på info-nivå utan att hela e-postadressen loggas.
- [ ] Tester för varje flöde: under gränsen skickas mejl, över gränsen inte, och svaret är identiskt.
- [ ] Beslutet om teknik (t.ex. Hammer med ETS eller egen tabell i Postgres) dokumenteras i ett ADR.

## Utanför scope
- CAPTCHA.
- Begränsning av inloggningsförsök med lösenord.

## Anteckningar
Appen körs på en nod tills vidare, så ETS räcker om vi inte behöver delad räkning mellan noder.
