# 0002: Kontosäkerhet

Status: accepterad (ticket 0001)

## Kontext
Kontoflödet bygger på `phx.gen.auth` (se ADR 0001). Säkerhets- och kodgranskningen visade luckor i
standardkoden: konton kunde enumereras, samtidiga förfrågningar kunde återanvända engångslänkar och
sessioner kunde överleva ett lösenordsbyte.

## Beslut
1. **Ingen enumerering.** `Accounts.register_user_and_deliver_instructions/3` och
   `Accounts.request_user_email_change/3` ger samma resultat (`{:ok, email}`, samma flash och
   redirect) för lediga och upptagna adresser. Är adressen upptagen får kontoägaren ett
   notismejl (`UserNotifier`) och ingen ändringslänk skickas. Andra valideringsfel visas som vanligt.
2. **Sudo-läge för inställningar.** `/users/settings*` ligger i en egen scope och live_session
   `:require_sudo_mode` (plugen kontrollerar på HTTP-anropet så att sökvägen sparas och användaren
   kommer tillbaka efter ny inloggning). Användarägda resurser stannar i `:require_authenticated_user`.
3. **Användarraden låses.** Allt som ändrar en användare och hens tokens (magic link-inloggning,
   e-postbyte, lösenordsbyte, skapande av sessionstoken) körs i en transaktion som först tar
   `SELECT ... FOR UPDATE` på användarraden (`lock_user/1`) och sedan rör tokens. Samma
   låsordning överallt (användarrad, sedan tokens) utesluter deadlocks. Token läses om efter låset,
   så en engångslänk kan bara lösas in en gång och en föråldrad e-postlänk kan inte skriva över ett
   redan genomfört byte.
4. **Sessionstoken kan nekas.** `generate_user_session_token/1` returnerar `{:ok, token}` eller
   `{:error, :credentials_changed}` om lösenordshashen ändrats sedan autentiseringen. Då skapas ingen
   session, så en inloggning som pågår under ett lösenordsbyte överlever det inte.
5. **Ersatta webbläsartokens återkallas.** Vid ny inloggning raderas webbläsarens tidigare
   sessionstoken när den nya skapats (`UserAuth.log_in_user/3`), så gamla tokens inte blir kvar.
6. Lösenord över 72 byte nekas med valideringsfel innan bcrypt körs.

## Konsekvenser
- Nya flöden som ändrar användare eller tokens måste ta `lock_user/1` först.
- Notismejl gör att mejl kan skickas till adresser utan konto-åtgärd; det är avsiktligt.

## Uppskjutet
- **Rate limiting av mejl** (fynd S3): ingen gräns finns för utskick. Ticket 0011.
- **Change-email-token vid samtidigt lösenordsbyte:** en ändringslänk vars insert väntade på
  användarlåset kan skapas efter lösenordsbytet och är då inte återkallad. Åtgärd skulle vara en
  hashkontroll vid utfärdandet. Inte schemalagt; ta upp om e-postbyte hårdnas.
