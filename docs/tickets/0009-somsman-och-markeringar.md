---
id: 0009
title: Sömsmån och markeringar
status: todo
type: feature
---

## Bakgrund
Ett mönster går inte att klippa ut utan sömsmån och markeringar.

## Önskat beteende
Varje mönsterdel får en sömsmån som standard (1 cm) som kan ändras per kant. Mönsterdelarna visar
trådriktning, hack, vikningskant och namn.

## Acceptanskriterier
- [ ] Motorn räknar fram en sömsmånskontur (offset) runt varje mönsterdel, med rätt hörn där kanter möts, även vid kurvor.
- [ ] Sömsmånen kan ställas in per kant (inklusive 0, t.ex. vid vikningskant). Standardvärdet ställs in per projekt.
- [ ] Inprovningar får korrekt "inprovningsspets" på sömsmånen (sömsmånen följer inprovningen när den är stängd), eller så dokumenteras en enklare approximation i ett ADR.
- [ ] Markeringar: trådriktningspil, hack (passmärken), vikningskant, delnamn, och "klipp 2"/"klipp 1 i fold".
- [ ] Sömlinje och skärlinje visas tydligt olika (t.ex. streckad och heldragen).
- [ ] Motortester för offset av rektangel, en kurva och en del med inprovning.

## Utanför scope
- Knapphål, fickplacering.
