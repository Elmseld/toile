---
id: 0001
title: Användarkonton och inloggning
status: todo
type: feature
---

## Bakgrund
Måttprofiler och mönsterprojekt är personliga och måste kopplas till ett konto.

## Önskat beteende
Användaren kan registrera sig, logga in och ut och återställa lösenord. Inloggade användare kommer
till en tom startsida ("Mina mönster"), som fylls i senare tickets.

## Acceptanskriterier
- [ ] Registrering, inloggning, utloggning och lösenordsåterställning fungerar (Phoenix standardgenerator `phx.gen.auth` är okej).
- [ ] Sidor för måttprofiler och mönster kräver inloggning. Utloggade skickas till inloggningen.
- [ ] Det finns ett mönster för hur resurser scopas per användare, så att senare tickets kan följa det.
- [ ] Startsidan visar "Mina mönster" för inloggade och en kort beskrivning av Toile för utloggade.

## Utanför scope
- Social inloggning, organisationer och roller.

## Anteckningar
Mejl i dev går till Swoosh lokala brevlåda. Ingen riktig mejlleverantör behövs ännu.
