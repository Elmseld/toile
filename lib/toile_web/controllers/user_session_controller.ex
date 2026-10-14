defmodule ToileWeb.UserSessionController do
  use ToileWeb, :controller

  alias Toile.Accounts
  alias ToileWeb.UserAuth

  def create(conn, %{"_action" => "confirmed"} = params) do
    create(conn, params, "Ditt konto är bekräftat.")
  end

  def create(conn, params) do
    create(conn, params, "Välkommen tillbaka!")
  end

  # magic link login
  defp create(conn, %{"user" => %{"token" => token} = user_params}, info) do
    case Accounts.login_user_by_magic_link(token) do
      {:ok, {user, tokens_to_disconnect}} ->
        UserAuth.disconnect_sessions(tokens_to_disconnect)

        conn
        |> put_flash(:info, info)
        |> UserAuth.log_in_user(user, user_params)

      _ ->
        conn
        |> put_flash(:error, "Länken är ogiltig eller har gått ut.")
        |> redirect(to: ~p"/users/log-in")
    end
  end

  # email + password login
  defp create(conn, %{"user" => user_params}, info) do
    %{"email" => email, "password" => password} = user_params

    if user = Accounts.get_user_by_email_and_password(email, password) do
      conn
      |> put_flash(:info, info)
      |> UserAuth.log_in_user(user, user_params)
    else
      # In order to prevent user enumeration attacks, don't disclose whether the email is registered.
      conn
      |> put_flash(:error, "Fel e-post eller lösenord.")
      |> put_flash(:email, String.slice(email, 0, 160))
      |> redirect(to: ~p"/users/log-in")
    end
  end

  def update_password(conn, %{"user" => user_params}) do
    user = conn.assigns.current_scope.user

    # Sudo mode can expire between the LiveView validating the form and the
    # browser submitting it, and the route can also be posted to directly.
    with {:sudo, true} <- {:sudo, Accounts.sudo_mode?(user)},
         {:ok, {user, expired_tokens}} <- Accounts.update_user_password(user, user_params) do
      # disconnect all existing LiveViews with old sessions
      UserAuth.disconnect_sessions(expired_tokens)

      # The password change deleted every session token, so log the user in
      # again directly rather than re-verifying the submitted credentials.
      conn
      |> put_session(:user_return_to, ~p"/users/settings")
      |> put_flash(:info, "Lösenordet är ändrat.")
      |> UserAuth.log_in_user(user, user_params)
    else
      {:sudo, false} ->
        conn
        |> put_session(:user_return_to, ~p"/users/settings")
        |> put_flash(:error, "Du måste logga in igen för att se den här sidan.")
        |> redirect(to: ~p"/users/log-in")

      {:error, %Ecto.Changeset{}} ->
        conn
        |> put_flash(
          :error,
          "Lösenordet kunde inte ändras. Kontrollera uppgifterna och försök igen."
        )
        |> redirect(to: ~p"/users/settings")
    end
  end

  def delete(conn, _params) do
    conn
    |> put_flash(:info, "Du är utloggad.")
    |> UserAuth.log_out_user()
  end
end
