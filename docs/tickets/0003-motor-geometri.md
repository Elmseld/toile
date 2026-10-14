---
id: 0003
title: Mönstermotor – punkter, kurvor och mönsterdelar
status: todo
type: feature
---

## Bakgrund
Grundmönster konstrueras med klassiska konstruktionssteg: "punkt längs linje", "vinkelrät från",
"skärning mellan två linjer" och så vidare. Motorn ska kunna uttrycka och räkna ut dem, så att
mönstret räknas om när måtten ändras.

## Önskat beteende
En **mönsterdefinition** (JSON) beskriver parametrar, punkter, kurvor och mönsterdelar.
Motorn tar definitionen och mått och ger tillbaka beräknad geometri, redo att rita som SVG.

## Acceptanskriterier
- [ ] Ett dokumenterat och versionerat JSON-format för mönsterdefinitioner, med TypeScript-typer och validering.
- [ ] Punktoperationer: startpunkt, förskjutning (dx, dy), längs linje (avstånd), längs vinkel (avstånd + vinkel), vinkelrät från linje, skärning linje–linje, skärning linje–cirkel, mittpunkt.
- [ ] Alla längder och vinklar i operationerna är formler (från 0002) och kan referera till tidigare punkters avstånd och vinklar.
- [ ] Kurvor: räta linjer och kubiska Bézier med kontrollpunkter som också är definierade punkter.
- [ ] Mönsterdel: ordnad sluten kontur av linjer/kurvor, med namn och trådriktning.
- [ ] Funktioner för längd av linje/kurva, så att t.ex. ärmhålets längd kan mätas av andra mönster.
- [ ] Varje punkt kan ha en användarförskjutning (offset) som läggs på efter beräkningen.
- [ ] En hjälpfunktion som gör om beräknad geometri till SVG-sökvägar.
- [ ] Enhetstester för varje operation, plus ett litet exempelmönster (rektangel med en inprovning) som testas mot två olika måttuppsättningar.

## Utanför scope
- Sömsmån (0009), gradering, UI.

## Anteckningar
Koordinatsystem som SVG: origo uppe till vänster, y nedåt.
