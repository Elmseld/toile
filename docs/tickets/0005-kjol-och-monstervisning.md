---
id: 0005
title: Grundmönster kjol och visning av mönsterprojekt
status: todo
type: feature
---

## Bakgrund
Kjolen är det enklaste grundmönstret och det första som visar hela kedjan från mått till mönster.
Här skapas också mönsterprojekt och den första visningen.

## Önskat beteende
Användaren klickar "Nytt mönster", väljer grundmönstret Rak kjol och en måttprofil och får ett
projekt som visar fram- och bakstycke ritade i SVG i rätt proportioner, med zoom och panorering.

## Acceptanskriterier
- [ ] Grundmönster "Rak kjol" som mönsterdefinition: fram- och bakstycke med midjeinprovningar och höftkurva, enligt en etablerad metrisk konstruktionsmetod (källan anges i definitionen).
- [ ] Rörelsevidd i midja och höft samt kjollängd är parametrar med rimliga standardvärden.
- [ ] Mönsterprojekt lagras per användare: namn, grundmönster, måttprofil, mönsterdefinition (JSON) och parametervärden.
- [ ] "Mina mönster" listar projekten. Man kan skapa, döpa om och ta bort projekt.
- [ ] Projektsidan ritar mönstret med motorn i klienten (JS-hook), med zoom (hjul/nyp) och panorering (dra), och visar ett rutnät i cm.
- [ ] Byter man måttprofil räknas mönstret om. Saknas mått som mönstret behöver visas vilka, i stället för ett trasigt mönster.
- [ ] Ett motortest kontrollerar att kjolens midja och höft (sömlinje, utan inprovningar) motsvarar mått + rörelsevidd inom 1 mm.

## Utanför scope
- Redigering av punkter (0008). Sömsmån (0009). Utskrift (0010).

## Anteckningar
Grundmönstren ligger som data i repot (t.ex. `engine/blocks/`) och kopieras in i projektet när det skapas.
Senare ändringar av grundmönstret påverkar alltså inte befintliga projekt.
