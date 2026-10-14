---
id: 0010
title: PDF-utskrift i skala 1:1 på A4
status: todo
type: feature
---

## Bakgrund
De flesta hemmasömmare skriver ut mönster på vanlig skrivare och tejpar ihop sidorna.

## Önskat beteende
Från projektsidan kan användaren ladda ner en PDF där mönstret ligger i skala 1:1, kaklat på A4 med
överlapp, så att sidorna går att tejpa ihop.

## Acceptanskriterier
- [ ] PDF:en innehåller alla mönsterdelar i skala 1:1, med sömsmån och markeringar från 0009.
- [ ] Sidorna har en marginal och klistermärken/kanter för att passa ihop. Varje sida är märkt med rad och kolumn (t.ex. "B3").
- [ ] Första sidan innehåller en testruta på exakt 10 × 10 cm och en översiktskarta över sidorna.
- [ ] Tomma sidor (utan mönster) skrivs inte ut.
- [ ] Ett automatiskt test kontrollerar att testrutan är 10 × 10 cm i PDF-koordinater (283,46 pt) och att en känd linje i mönstret har rätt längd.
- [ ] Användaren väljer A4 eller Letter (A4 som standard).

## Utanför scope
- A0/plotter, projektorläge, läggplan.

## Anteckningar
PDF:en kan genereras i klienten eller på servern med motorns SVG-utdata. Planner väljer, men
geometrin ska komma från motorn (se principerna i `docs/product.md`).
