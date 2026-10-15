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
Expected: (1) a validation error on the form; (2) redirect to `/users/log-in` with "Vi har skickat ett mejl till …".

### Magic-link login
1. Open the newest mail in `/dev/mailbox` and follow the `/users/log-in/<token>` link.
2. Click "Bekräfta och logga in bara den här gången".
Expected: `/patterns` with "Mina mönster", "Du har inga mönster än." and the logged-in nav (`#nav-log-out`).

### Set password
1. On `/users/settings`, submit a password shorter than 12 characters.
2. Submit a valid password and matching confirmation.
Expected: (1) a length error; (2) the flash "Lösenordet är ändrat."

### Logout
1. Click `#nav-log-out`.
Expected: `/` with "Du är utloggad." and no logged-in nav.

### Password login
1. On `/users/log-in`, submit the password form with a wrong password.
2. Submit it with the right password.
Expected: (1) "Fel e-post eller lösenord." and still logged out; (2) `/patterns` with "Välkommen tillbaka!"
