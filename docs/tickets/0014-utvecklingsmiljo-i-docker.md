---
id: 0014
title: Kör hela utvecklingsmiljön i Docker
status: todo
type: chore
---

## Bakgrund
I dag körs bara Postgres i Docker. Elixir, Erlang och Bun installeras lokalt på datorn. Det har redan
gett versionsglidning: lokalt kördes Elixir 1.20.4 och OTP 29.1.2 medan `.tool-versions` och CI
låg på 1.20.3 och 29.0.5, och Hex var byggt för fel OTP-version. Utvecklarens andra projekt kör
appen i Docker, så samma arbetssätt här gör det enklare att växla mellan projekt och att sätta upp
miljön på en ny dator.

Körs efter 0013, så att Docker-imagen byggs med de uppgraderade versionerna.

## Önskat beteende
`docker compose up` startar både databasen och appen på localhost:4000 med kodomladdning. Tester,
kontroller och engine-kommandon körs i containern. Ingen Elixir, Erlang eller Bun behöver vara
installerad på datorn, och versionerna i Docker är desamma som i CI.

## Acceptanskriterier
- [ ] En utvecklings-`Dockerfile` (eller ett `dev`-target) med de Erlang-, Elixir- och Bun-versioner som står i `.tool-versions`. Det finns en enda källa för versionerna, eller en CI-kontroll som felar om Dockerfile och `.tool-versions` inte stämmer överens.
- [ ] `compose.yaml` har en `app`-tjänst som beror på `db` (healthcheck). Den monterar koden och kör `mix setup` vid behov och sedan `mix phx.server` på port 4000. `deps`, `_build`, `engine/node_modules` och Hex/Mix-cachen ligger i namngivna volymer så att omstarter går snabbt.
- [ ] Databasvärden kommer från miljövariabler (t.ex. `DATABASE_HOST`, default `localhost`), så att appen når `db` i Docker och `localhost` i CI. `config/dev.exs` och `config/test.exs` läser dem.
- [ ] Kodomladdning fungerar när en fil ändras på datorn (LiveView och CSS/JS-watchers). Det verifieras manuellt och noteras i PR:en.
- [ ] Tester och kontroller går att köra i containern: `docker compose exec app mix precommit` och `docker compose exec app sh -c "cd engine && bun run typecheck && bun test"`, eller motsvarande alias/skript.
- [ ] `CLAUDE.md` beskriver alla kommandon via Docker, eftersom agenterna i `/ship` läser kontrollkommandona därifrån. `README.md` beskriver start, tester, `iex` (`docker compose exec app iex -S mix`) och hur man rensar volymer.
- [ ] `.claude/launch.json` startar appen via `docker compose up`, och `.claude/smoke-test.md` stämmer med det nya sättet att starta.
- [ ] CI går igenom, med samma versioner som Docker-imagen. CI får fortsätta använda setup-beam om versionerna garanterat är desamma.
- [ ] `/smoke-test` går igenom med appen i Docker.

## Utanför scope
- En produktions-image och deploy.
- Att byta CI till att bygga och köra Docker-imagen, om det inte behövs för att hålla versionerna i synk.

## Anteckningar
- Bas-image: officiella `hexpm/elixir`-images med rätt Elixir/OTP-kombination, plus Bun. Använd inte Naymspaces interna images, eftersom det här är ett privat projekt på GitHub.
- På macOS kan filsynkningen göra kompilering långsammare. Mät tiden för `mix test` lokalt mot i Docker och notera den i PR:en.
- Kör containern som en icke-root-användare eller med rätt uid, så att filer som skapas i den monterade koden (t.ex. migreringar från generatorer) inte blir ägda av root på datorn.
