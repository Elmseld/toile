---
id: 0008
title: Editor – flytta punkter och ändra formler och parametrar
status: todo
type: feature
---

## Bakgrund
Konstruktion handlar om att utgå från ett grundmönster och ändra det. Användaren måste kunna
justera mönstret direkt, med mus, touch och penna.

## Önskat beteende
På projektsidan kan användaren välja en punkt och dra den, eller öppna punkten och ändra dess
formel. Parametrar (t.ex. rörelsevidd) kan ändras i en sidopanel. Allt räknas om direkt.

## Acceptanskriterier
- [ ] Punkter går att markera och dra med mus, touch och penna (pointer events). Dragningen sparas som förskjutning (offset) och beroende punkter och kurvor följer med under dragningen.
- [ ] Kontrollpunkter för Bézierkurvor går att dra.
- [ ] En panel visar markerad punkts operation och formler. Ändrade formler valideras, och fel visas utan att mönstret försvinner.
- [ ] En parameterpanel listar mönstrets parametrar och låter användaren ändra dem.
- [ ] Ångra och gör om (minst 50 steg) inom en session.
- [ ] Ändringar sparas till projektet (autosparning eller tydlig spara-knapp). Vid omladdning syns samma mönster.
- [ ] Omräkning under dragning känns direkt (inga serveranrop per rörelse).
- [ ] Ett test (LiveView eller JS) täcker att en sparad förskjutning finns kvar efter omladdning.

## Utanför scope
- Lägga till nya punkter och linjer från grunden, flytta inprovningar, slash & spread.

## Anteckningar
Motorn finns i klienten via JS-hooken från 0005. Servern tar emot och validerar mönsterdefinitionen vid sparning.
