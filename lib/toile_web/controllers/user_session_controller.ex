defmodule ToileWeb.UserSessionController do
  use ToileWeb, :controller

  alias Toile.Accounts
  alias ToileWeb.UserAuth

  def create(conn, %{"_action" => "confirmed"} = params) do
    create(conn, params, gettext("Your account has been confirmed."))
  end

  def create(conn, params) do
    create(conn, params, gettext("Welcome back!"))
  end

  # magic link login
  defp create(conn, %{"user" => %{"token" => token} = user_params}, info)
       when is_binary(token) do
    case Accounts.login_user_by_magic_link(token) do
      {:ok, {user, tokens_to_disconnect}} ->
        UserAuth.disconnect_sessions(tokens_to_disconnect)

        conn
        |> put_flash(:info, info)
        |> UserAuth.log_in_user(user, user_params)

      _ ->
        conn
        |> put_flash(:error, gettext("The link is invalid or has expired."))
        |> redirect(to: ~p"/users/log-in")
    end
  end

  # email + password login
  defp create(conn, %{"user" => %{"email" => email, "password" => password} = user_params}, info)
       when is_binary(email) and is_binary(password) and not is_map_key(user_params, "token") do
    if user = Accounts.get_user_by_email_and_password(email, password) do
      conn
      |> put_flash(:info, info)
      |> UserAuth.log_in_user(user, user_params)
    else
      invalid_credentials(conn, email)
    end
  end

  # Missing or malformed params (no "user" map, missing fields, non-string
  # values) are attacker-controlled input; answer exactly like wrong credentials.
  defp create(conn, _params, _info), do: invalid_credentials(conn, nil)

  # In order to prevent user enumeration attacks, don't disclose whether the email is registered.
  defp invalid_credentials(conn, email) do
    conn
    |> put_flash(:error, gettext("Invalid email or password."))
    |> maybe_keep_email(email)
    |> redirect(to: ~p"/users/log-in")
  end

  defp maybe_keep_email(conn, email) when is_binary(email),
    do: put_flash(conn, :email, String.slice(email, 0, 160))

  defp maybe_keep_email(conn, _email), do: conn

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
      |> put_flash(:info, gettext("Your password has been changed."))
      |> UserAuth.log_in_user(user, user_params)
    else
      {:sudo, false} ->
        conn
        |> put_session(:user_return_to, ~p"/users/settings")
        |> put_flash(:error, gettext("You must log in again to access this page."))
        |> redirect(to: ~p"/users/log-in")

      {:error, %Ecto.Changeset{}} ->
        conn
        |> put_flash(
          :error,
          gettext("The password could not be changed. Check the details and try again.")
        )
        |> redirect(to: ~p"/users/settings")
    end
  end

  def delete(conn, _params) do
    conn
    |> put_flash(:info, gettext("You have been logged out."))
    |> UserAuth.log_out_user()
  end
end
