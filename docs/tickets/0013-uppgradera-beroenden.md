---
id: 0013
title: Uppgradera Elixir och beroenden
status: todo
type: chore
---

## Bakgrund
Projektet skapades med ett äldre `phx_new`-arkiv. Kraven i `mix.exs` matchar därför inte det vi
faktiskt kör, och några beroenden ligger en minor-version efter:

- `mix.exs` kräver `elixir: "~> 1.15"`, men vi kör 1.20.3 och 1.20.4 finns.
- `phoenix_live_view` 1.1.33 (`~> 1.1.0`), senaste är 1.2.12.
- `phoenix_live_dashboard` 0.8.7 (`~> 0.8.3`), senaste är 0.9.1.
- `dns_cluster` 0.2.0 (`~> 0.2.0`), senaste är 0.3.1.
- `{:phoenix, "~> 1.8.5"}` är redan låst till 1.8.15, men kravet bör spegla det.

Det är billigare att uppgradera nu, innan editorn och JS-hookarna (0005, 0008) byggs ovanpå LiveView.

## Önskat beteende
Appen kör senaste Elixir-patchen och senaste versionerna av beroendena ovan, och kraven i `mix.exs`
och `.tool-versions` stämmer med det som används lokalt och i CI. Inget beteende ändras för användaren.

## Acceptanskriterier
- [ ] `.tool-versions` anger Elixir 1.20.4 (och senaste Erlang 29-patchen om det finns en nyare). CI använder samma versioner.
- [ ] `mix.exs` kräver `elixir: "~> 1.20"` och `{:phoenix, "~> 1.8.15"}`.
- [ ] `phoenix_live_view` är uppgraderat till 1.2.x, `phoenix_live_dashboard` till 0.9.x och `dns_cluster` till 0.3.x. `mix hex.outdated` visar inga beroenden där "Update not possible" beror på våra egna krav.
- [ ] Brytande ändringar och deprecations i LiveView 1.2, LiveDashboard 0.9 och dns_cluster 0.3 är genomgångna enligt deras changelogs och hanterade. JS-paketet `phoenix_live_view` i assets följer samma version.
- [ ] `mix precommit` går igenom utan varningar (inga nya deprecation-varningar), och engine-kontrollerna går igenom.
- [ ] Kontofunktionerna från 0001 (registrering, inloggning, inställningar, utloggning) fungerar i webbläsaren efter uppgraderingen.
- [ ] README nämner hur man installerar rätt verktygsversioner (t.ex. `asdf install` eller `mise install` utifrån `.tool-versions`).

## Utanför scope
- Nya funktioner, eller att börja använda nya LiveView 1.2-API:er utöver det som krävs.
- Uppgradering av Phoenix till 1.9 eller Postgres till en ny major.

## Anteckningar
Kör efter att PR för 0001 är mergad. Kom ihåg att uppdatera det lokala generator-arkivet också:
`mix archive.install hex phx_new` (påverkar inte projektet, men framtida projekt).
