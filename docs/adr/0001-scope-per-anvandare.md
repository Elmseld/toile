# 0001: Scope per användare

Status: accepterad (ticket 0001)

## Kontext
Måttprofiler (0004) och mönsterprojekt (0005) är privata för varje användare. Utan en gemensam
regel är det lätt att glömma ett användarfilter och läcka data mellan konton. Phoenix 1.8:s
`mix phx.gen.auth` genererar `Toile.Accounts.Scope`, som bär den inloggade användaren genom appen.
Ticketen lägger också till beroendet `bcrypt_elixir` för lösenordshashning.

## Beslut
Konton skapas med `mix phx.gen.auth Accounts User users --live --hashing-lib bcrypt`.
`config :toile, :scopes` registrerar `user` som standardscope, så `mix phx.gen.live`, `phx.gen.context`
och `phx.gen.schema` genererar scopad kod. Varje användarägd resurs följer dessa regler:

1. Kontextfunktioner tar `%Toile.Accounts.Scope{}` som första argument: `list_x(scope)`,
   `get_x!(scope, id)`, `create_x(scope, attrs)`, `update_x(scope, x, attrs)`,
   `delete_x(scope, x)`, `change_x(scope, x, attrs)`.
2. Frågor filtrerar alltid på `user_id == ^scope.user.id`. `get_x!/2` använder
   `Repo.get_by!(X, id: id, user_id: scope.user.id)`, så en annan användares id ger
   `Ecto.NoResultsError` (404).
3. `user_id` finns aldrig i `cast/3`. Det sätts från scopet när posten skapas. Update och delete
   kontrollerar att `x.user_id == scope.user.id`.
4. Tabeller har `user_id references(:users, type: :binary_id, on_delete: :delete_all)` och ett index
   på `user_id`.
5. PubSub-topics är per användare: `"user:#{scope.user.id}:x"`.
6. LiveViews får `socket.assigns.current_scope` från live_session `:require_authenticated_user`
   och skickar det vidare. De läser aldrig `user_id` från params. Alla sidor för måttprofiler och
   mönster läggs i den live_sessionen. Kontoinställningar (`/users/settings`) ligger i en egen
   scope med `:require_sudo_mode` (nylig inloggning krävs); användarägda resurser som `/patterns`
   kräver inte sudo-läge och stannar i `:require_authenticated_user`.
7. Varje resurs har ett test som visar att en annan användares scope inte kan lista, hämta,
   ändra eller ta bort den (`user_scope_fixture/0`).
8. Nya resurser startas med `mix phx.gen.live ...`, som använder standardscopet.

## Konsekvenser
- Läckage mellan konton blir ett strukturellt fel som tester fångar, inte något man måste komma ihåg.
- Kontextfunktioner utan scope är inte tillåtna för användarägd data.
- Lösenordsåterställning är Phoenix 1.8:s standardflöde: inloggning med e-postlänk, sedan nytt
  lösenord under Inställningar. En klassisk återställningssida är en eventuell uppföljande ticket.
- Registrering sker med enbart e-post. Kontot bekräftas via länk och lösenord sätts efteråt.
- Säkerhetsbeslut för konton (token-hantering, låsordning, enumerering) står i
  `docs/adr/0002-kontosakerhet.md`.
