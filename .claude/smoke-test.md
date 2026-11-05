# Smoke test flows

Boot: the `toile` entry in `.claude/launch.json` (`docker compose up`: Postgres and the app on
localhost:4000; the first start compiles deps and can take a few minutes). Ready when `GET /`
answers 200.

Worktree stacks can run on another port (e.g. 4015). Magic links in `/dev/mailbox` point at 4000;
open the same path on the stack's port.

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

### Email rate limit
1. Log out. On `/users/log-in`, request a login link for the same address 4 times.
2. Log in, and on `/users/settings` request an email change to a new address 4 times.
Expected: (1) every request shows the flash "Om din e-postadress finns hos oss får du snart ett mejl med instruktioner för att logga in.", but `/dev/mailbox` holds only 3 login mails; the 4th request sends nothing and the server log has an info line "Email not sent, rate limit reached" with a masked address; (2) every request shows "Vi har skickat en länk till den nya adressen. Öppna den för att bekräfta ändringen.", `/dev/mailbox` holds only 3 change mails, and the 4th sends nothing.
Notes: in dev all browser requests share the Docker gateway IP, so `config/dev.exs` raises the per-IP limit to 1000 an hour (the per-recipient limit of 3 per 15 minutes stays). Changes under `config/` need an app restart (`docker compose restart app`); the code reloader does not pick them up.

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
1. Create a measurement profile with a value for every measurement except Nacke till armhålsnivå.
2. On `/patterns/new`, open the block select ("Välj ett grundmönster"; "Liv" and "Rak kjol", sorted by label), choose "Liv" and that profile, and save.
3. On the project page, click "Redigera måttprofil", enter a value for Nacke till armhålsnivå and save.
4. Check the project page again.
Expected: (2) the project page lists "Nacke till armhålsnivå" under "Mått som saknas för det här mönstret" with nothing drawn; (3) saving returns to the project; (4) "Bakstycke" and "Framstycke" are drawn over the cm grid.

### Pattern editor
Do this with the mouse and again with touch emulation.
1. Open a "Rak kjol" project and drag a hem point.
2. Reload the page.
3. Open a "Liv" project and drag an armhole control point (a hollow handle).
4. Select a point with the select "Välj en punkt", type `waist / ` into a formula field, then fix it.
5. Change a value in the "Justeringar" panel, then empty the field.
6. Click "Ångra" and "Gör om", then press Ctrl+Z.
7. On a "Liv" project, change a value under "Justeringar", then click "Rak ärm" under "Lägg till i mönstret".
8. Drag an armhole point of the bodice, then a point of the sleeve cap, change "Extra vidd i ärmkullen" under "Rak ärm" in "Justeringar", and reload.
Expected: (1) the outline follows during the drag, the label moves at release and the status shows "Sparat"; (2) the moved point is still moved; (3) the armhole curve follows; (4) an error shows under the field and the drawing stays until the formula is valid; (5) the pattern updates, and an empty field returns to the default; (6) each step is undone and redone, and the buttons are disabled when there is nothing left; (7) the sleeve is drawn beside the bodice, "Välj en punkt" groups the points under "Liv" and "Rak ärm", "Justeringar" lists both parts under their names, the changed value stays and "Ångra" still undoes it; (8) the sleeve cap follows the bodice drag, the sleeve point and value save ("Sparat"), and after the reload all of it is still there.
### Sleeve project
1. On a "Liv" project with a complete profile, click "Rak ärm" under "Lägg till i mönstret".
2. Open `/patterns/new` and look at the block select.
3. Back on the project, switch to a profile without arm measurements.
Expected: (1) the flash "Rak ärm har lagts till", the sleeve drawn next to the bodice with notches, and the "Rak ärm" button gone; (2) the select offers only "Liv" and "Rak kjol"; (3) "Mått som saknas för det här mönstret" lists "Ärmlängd", "Överarmsvidd" and "Handledsvidd" with nothing drawn.

### Markings and seam allowance
1. Open a "Rak kjol" project with a complete profile.
2. Look at the pieces, then set "Sömsmån" to 2 and tap one edge (or use "Välj en kant") and set it to 0.
3. Wait for "Sparat", then reload.
4. Enter "11" as the default allowance.
5. Set the default to 5.
Expected: (2) the labels "klipp 2" (Bakstycke) and "klipp 1 i fold" (Framstycke), the seam line dashed inside the solid cutting line, a dash-dot fold line, and the edge redrawn at once; (3) both values are still there; (4) "Ange en sömsmån från 0 till 10,0 cm" and nothing is saved; (5) the pieces do not overlap.
