# Smoke test flows

Boot: the `toile` entry in `.claude/launch.json` (`docker compose up`: Postgres and the app on
localhost:4000; the first start compiles deps and can take a few minutes). Ready when `GET /`
answers 200.

Login: no seed user. Register a fresh address (e.g. `smoke-<timestamp>@toile.test`) and log in with
the magic link from the dev mailbox at `/dev/mailbox`. For password login, set any 12+ character
test password under Inställningar first.

## Critical flows

### Landing page
1. Open `/` logged out.
Expected: `#landing` with Swedish text and the links `#landing-register` and `#landing-log-in`.

### Protected route
1. Open `/patterns` logged out.
Expected: redirect to `/users/log-in` with the flash "Du måste logga in för att se den här sidan."

### Registration
1. On `/users/register`, submit an invalid email.
2. Submit a new valid email.
Expected: (1) the Swedish validation error "måste innehålla @ och får inte innehålla mellanslag" on the form; (2) redirect to `/users/log-in` with "Vi har skickat ett mejl till …".

### Magic-link login
1. Open the newest mail in `/dev/mailbox` and follow the `/users/log-in/<token>` link.
2. Click "Bekräfta och logga in bara den här gången".
Expected: `/patterns` with "Mina mönster", "Du har inga mönster än." and the logged-in nav (`#nav-log-out`).

### Set password
1. On `/users/settings`, submit a password shorter than 12 characters.
2. Submit a valid password and matching confirmation.
Expected: (1) the Swedish length error "ska vara minst 12 tecken"; (2) the flash "Lösenordet är ändrat."

### Logout
1. Click `#nav-log-out`.
Expected: `/` with "Du är utloggad." and no logged-in nav.
Note: a flash toast in the top right can cover `#nav-log-out` until it closes; wait for it or close it first.

### Password login
1. On `/users/log-in`, submit the password form with a wrong password.
2. Submit it with the right password.
Expected: (1) "Fel e-post eller lösenord." and still logged out; (2) `/patterns` with "Välkommen tillbaka!"

### Measurement profiles
1. Logged in, click `#nav-measurements` ("Mått") and create a profile with a name and "72,5" for Midjevidd.
2. Edit it and enter "0", then "301", then "72,55" for Midjevidd.
3. Save a new profile with only a name.
4. Delete a profile and confirm.
Expected: (1) the profile page shows "72,5 cm" (stored as 725 mm); (2) "måste vara större än 0 och högst 300 cm" for 0 and 301, "måste vara ett tal i cm med högst en decimal" for 72,55; (3) saved, with "Saknas" markers on the profile page and "N mått saknas" on the index; (4) the confirm "Vill du ta bort måttprofilen?" and the flash "Måttprofilen har tagits bort".

### Pattern projects
1. Create a complete measurement profile (Midjevidd, Stussvidd, Midja till stuss, Kjollängd).
2. On `/patterns` click "Nytt mönster", enter a name, choose "Rak kjol" from the block select (prompt "Välj ett grundmönster", nothing preselected) and that profile, and save.
3. On the project page, zoom with the wheel, drag to pan, then click "Anpassa till skärmen".
4. Switch the profile select to a profile missing measurements.
5. Rename the project.
6. Delete the project from the list and confirm.
Expected: (2) the project page with "Bakstycke" and "Framstycke" drawn over a cm grid; (3) the view zooms, pans and returns to the fitted view; (4) "Mått som saknas för det här mönstret" lists the missing measurements and nothing is drawn; (5) the flash "Mönstret har bytt namn"; (6) the confirm "Vill du ta bort mönstret?" and the flash "Mönstret har tagits bort".

### Bodice project
1. Create a measurement profile with a value for every measurement except Ärmhålsdjup.
2. On `/patterns/new`, open the block select ("Välj ett grundmönster"; "Livstycke" and "Rak kjol", sorted by label), choose "Livstycke" and that profile, and save.
3. On the project page, click "Redigera måttprofil", enter a value for Ärmhålsdjup and save.
4. Check the project page again.
Expected: (2) the project page lists "Ärmhålsdjup" under "Mått som saknas för det här mönstret" with nothing drawn; (3) saving returns to the project; (4) "Bakstycke" and "Framstycke" are drawn over the cm grid.
