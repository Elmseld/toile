# Produktbeskrivning

<!-- Agenterna läser den här filen före varje ticket. Håll den aktuell och konkret. -->

## Vad är produkten?
Toile är en webbapp för att konstruera och utveckla sömnadsmönster. Användaren utgår från
parametriska grundmönster (livstycke, kjol, ärm) som räknas fram ur egna mått, ändrar dem och
skriver ut dem i skala 1:1. Appen riktar sig både till hobbysömmare och till yrkesmässiga
mönsterkonstruktörer. Båda grupperna använder samma motor men får olika mycket av den synlig.

## Användare och roller
- **Användare**: ett konto, egna måttprofiler och egna mönsterprojekt. Ser och ändrar bara sitt eget.
- Lägen (kommer efter MVP): **hobbyläge** (reglage och guidad anpassning) och **proffsläge**
  (fri konstruktion, formler, gradering). I MVP finns ett läge, närmast proffsläget men enkelt.

## Kärnflöden (MVP)
1. **Mått**: användaren skapar en måttprofil ("Jag", "Kund Anna") och fyller i mått med hjälptexter.
2. **Nytt mönster**: användaren väljer grundmönster och måttprofil. Appen räknar fram mönstret och visar det.
3. **Ändra**: användaren drar i punkter, ändrar formler eller parametrar (t.ex. rörelsevidd), och
   mönstret räknas om direkt. Byte av måttprofil räknar om hela mönstret.
4. **Färdigställa**: sömsmån läggs till per kant. Markeringar (trådriktning, hack, vikningskant) visas.
5. **Skriva ut**: PDF i skala 1:1, kaklad på A4 med överlapp, numrering och testruta.

## Domänbegrepp
| Begrepp | Betydelse |
|---------|-----------|
| Mått (measurement) | Ett kroppsmått i en måttprofil, t.ex. `waist`, `hip`, `back_length`. |
| Måttprofil | Namngiven uppsättning mått för en person. |
| Grundmönster (block) | Mallmönster definierat med formler mot mått, utan design och utan sömsmån. |
| Mönsterdefinition | Data (JSON) som beskriver parametrar, punkter, kurvor och mönsterdelar. Det är den som lagras. |
| Parameter | Namngivet värde som inte är ett kroppsmått, t.ex. `ease_hip`. Kan exponeras som reglage. |
| Punkt | Definieras av en operation (t.ex. "längs linje A–B, avstånd `waist/4`"), inte av fria koordinater. |
| Mönsterdel (piece) | Sluten kontur av linjer/kurvor, t.ex. "framstycke". Har trådriktning och sömsmån per kant. |
| Mönsterprojekt | En användares mönster: en kopia av ett grundmönster och dess ändringar, kopplad till en måttprofil. |
| Inprovning (dart) | Kilformad intagning som formar plagget. |
| Sömsmån | Tillägg utanför sömlinjen. |
| Kakling (tiling) | Uppdelning av ett 1:1-mönster på flera A4-sidor. |

## Teknik
- **Phoenix 1.8 / LiveView** (Elixir 1.20, OTP 29) för konton, måttprofiler och lagring av
  mönsterprojekt. Postgres 17 via `docker compose`.
- **`engine/`**: mönstermotorn som rent TypeScript-paket (Bun för test och typkontroll).
  Den tar mönsterdefinition, mått och parametrar och ger geometri. Den har ingen DOM och ingen I/O.
  Editorn, PDF-exporten och ev. serverrendering använder samma kod.
- Editorn är en LiveView-sida med en JS-hook som kör motorn i klienten och ritar SVG.
  Dragning och omräkning sker helt i klienten. Servern får det sparade resultatet (mönsterdefinitionen).
- CI: GitHub Actions (`.github/workflows/ci.yml`).
- Kontroller: se `CLAUDE.md`.

## Principer och begränsningar
- **All geometri räknas i motorn.** Elixir lagrar och validerar mönsterdefinitioner men räknar
  aldrig ut geometri. Ingen geometrilogik i två språk.
- **Mönster är parametriska.** Punkter definieras relativt mått, parametrar och andra punkter,
  så att ett mönster går att räkna om för nya mått. Fria koordinater är bara tillåtna som
  förskjutning (offset) från en definierad punkt.
- **Enheter**: alla längder lagras och räknas i millimeter. UI visar centimeter med en decimal.
- **Koordinatsystem**: origo uppe till vänster, x åt höger, y nedåt (som SVG).
- Allt som en användare äger (måttprofiler, projekt) är privat för användaren och scopas per konto.
- Ska fungera med mus, touch och penna (pointer events) på desktop och surfplatta.
- Utskrift måste vara skalriktig. Testrutan i PDF:en ska mäta exakt 10 × 10 cm.

## Senare (inte MVP)
Gradering och storleksserier, hobbyläge med exponerade reglage, publicering och marknadsplats,
läggplan och tygåtgång, projektorläge, versionshistorik med provningsanteckningar,
3D-förhandsvisning, export till SVG/DXF.
