defmodule ToileWeb.UserSessionControllerTest do
  use ToileWeb.ConnCase, async: true

  import Toile.AccountsFixtures
  alias Toile.Accounts

  setup do
    %{unconfirmed_user: unconfirmed_user_fixture(), user: user_fixture()}
  end

  describe "POST /users/log-in - email and password" do
    test "logs the user in", %{conn: conn, user: user} do
      user = set_password(user)

      conn =
        post(conn, ~p"/users/log-in", %{
          "user" => %{"email" => user.email, "password" => valid_user_password()}
        })

      assert get_session(conn, :user_token)
      assert redirected_to(conn) == ~p"/"

      # Now do a logged in request and assert on the menu.
      # Logged-in users are sent from / to "Mina mönster".
      conn = get(conn, ~p"/")
      assert redirected_to(conn) == ~p"/patterns"
      conn = get(conn, ~p"/patterns")
      response = html_response(conn, 200)
      assert response =~ user.email
      assert response =~ ~p"/users/settings"
      assert response =~ ~p"/users/log-out"
    end

    test "logs the user in with remember me", %{conn: conn, user: user} do
      user = set_password(user)

      conn =
        post(conn, ~p"/users/log-in", %{
          "user" => %{
            "email" => user.email,
            "password" => valid_user_password(),
            "remember_me" => "true"
          }
        })

      assert conn.resp_cookies["_toile_web_user_remember_me"]
      assert redirected_to(conn) == ~p"/"
    end

    test "logs the user in with return to", %{conn: conn, user: user} do
      user = set_password(user)

      conn =
        conn
        |> init_test_session(user_return_to: "/foo/bar")
        |> post(~p"/users/log-in", %{
          "user" => %{
            "email" => user.email,
            "password" => valid_user_password()
          }
        })

      assert redirected_to(conn) == "/foo/bar"
      assert Phoenix.Flash.get(conn.assigns.flash, :info) =~ "Välkommen tillbaka!"
    end

    test "redirects to login page with invalid credentials", %{conn: conn, user: user} do
      conn =
        post(conn, ~p"/users/log-in?mode=password", %{
          "user" => %{"email" => user.email, "password" => "invalid_password"}
        })

      assert Phoenix.Flash.get(conn.assigns.flash, :error) == "Fel e-post eller lösenord."
      assert redirected_to(conn) == ~p"/users/log-in"
    end

    test "wrong password and unknown email give the same response", %{conn: conn, user: user} do
      user = set_password(user)

      wrong =
        post(conn, ~p"/users/log-in", %{
          "user" => %{"email" => user.email, "password" => "nope nope nope!"}
        })

      unknown =
        post(build_conn(), ~p"/users/log-in", %{
          "user" => %{"email" => "nobody@example.com", "password" => "nope nope nope!"}
        })

      assert redirected_to(wrong) == redirected_to(unknown)

      assert Phoenix.Flash.get(wrong.assigns.flash, :error) ==
               Phoenix.Flash.get(unknown.assigns.flash, :error)

      refute get_session(wrong, :user_token)
      refute get_session(unknown, :user_token)
    end

    test "logged-out request to /patterns returns there after login", %{conn: conn, user: user} do
      user = set_password(user)
      conn = get(conn, ~p"/patterns")
      assert redirected_to(conn) == ~p"/users/log-in"

      conn =
        conn
        |> recycle()
        |> Plug.Test.init_test_session(%{user_return_to: get_session(conn, :user_return_to)})
        |> post(~p"/users/log-in", %{
          "user" => %{"email" => user.email, "password" => valid_user_password()}
        })

      assert redirected_to(conn) == ~p"/patterns"
    end
  end

  describe "POST /users/log-in - malformed params" do
    for {name, params} <- [
          {"no user key", %{}},
          {"user is not a map", %{"user" => "nope"}},
          {"empty user map", %{"user" => %{}}},
          {"missing password", %{"user" => %{"email" => "a@example.com"}}},
          {"missing email", %{"user" => %{"password" => "hello world!!"}}},
          {"email is a list",
           %{"user" => %{"email" => ["a@example.com"], "password" => "hello world!!"}}},
          {"password is a map",
           %{"user" => %{"email" => "a@example.com", "password" => %{"x" => "y"}}}},
          {"token is a list", %{"user" => %{"token" => ["abc"]}}},
          {"token is a map", %{"user" => %{"token" => %{"a" => "b"}}}}
        ] do
      @params params
      test "gives the generic login error when #{name}", %{conn: conn} do
        conn = post(conn, ~p"/users/log-in", @params)

        assert Phoenix.Flash.get(conn.assigns.flash, :error) == "Fel e-post eller lösenord."
        assert redirected_to(conn) == ~p"/users/log-in"
        refute get_session(conn, :user_token)
      end
    end

    test "a non-string token does not fall back to password login", %{conn: conn, user: user} do
      user = set_password(user)

      conn =
        post(conn, ~p"/users/log-in", %{
          "user" => %{
            "token" => ["abc"],
            "email" => user.email,
            "password" => valid_user_password()
          }
        })

      assert Phoenix.Flash.get(conn.assigns.flash, :error) == "Fel e-post eller lösenord."
      assert redirected_to(conn) == ~p"/users/log-in"
      refute get_session(conn, :user_token)
    end
  end

  describe "POST /users/log-in - magic link" do
    test "logs the user in", %{conn: conn, user: user} do
      {token, _hashed_token} = generate_user_magic_link_token(user)

      conn =
        post(conn, ~p"/users/log-in", %{
          "user" => %{"token" => token}
        })

      assert get_session(conn, :user_token)
      assert redirected_to(conn) == ~p"/"

      # Now do a logged in request and assert on the menu.
      # Logged-in users are sent from / to "Mina mönster".
      conn = get(conn, ~p"/")
      assert redirected_to(conn) == ~p"/patterns"
      conn = get(conn, ~p"/patterns")
      response = html_response(conn, 200)
      assert response =~ user.email
      assert response =~ ~p"/users/settings"
      assert response =~ ~p"/users/log-out"
    end

    test "confirms unconfirmed user", %{conn: conn, unconfirmed_user: user} do
      {token, _hashed_token} = generate_user_magic_link_token(user)
      refute user.confirmed_at

      conn =
        post(conn, ~p"/users/log-in", %{
          "user" => %{"token" => token},
          "_action" => "confirmed"
        })

      assert get_session(conn, :user_token)
      assert redirected_to(conn) == ~p"/"
      assert Phoenix.Flash.get(conn.assigns.flash, :info) =~ "Ditt konto är bekräftat."

      assert Accounts.get_user!(user.id).confirmed_at

      # Now do a logged in request and assert on the menu.
      # Logged-in users are sent from / to "Mina mönster".
      conn = get(conn, ~p"/")
      assert redirected_to(conn) == ~p"/patterns"
      conn = get(conn, ~p"/patterns")
      response = html_response(conn, 200)
      assert response =~ user.email
      assert response =~ ~p"/users/settings"
      assert response =~ ~p"/users/log-out"
    end

    test "redirects to login page when magic link is invalid", %{conn: conn} do
      conn =
        post(conn, ~p"/users/log-in", %{
          "user" => %{"token" => "invalid"}
        })

      assert Phoenix.Flash.get(conn.assigns.flash, :error) ==
               "Länken är ogiltig eller har gått ut."

      assert redirected_to(conn) == ~p"/users/log-in"
    end

    test "redirects to login page when magic link is not valid Base64url", %{conn: conn} do
      conn = post(conn, ~p"/users/log-in", %{"user" => %{"token" => "!"}})

      assert Phoenix.Flash.get(conn.assigns.flash, :error) ==
               "Länken är ogiltig eller har gått ut."

      assert redirected_to(conn) == ~p"/users/log-in"
    end
  end

  describe "POST /users/update-password" do
    @new_password "a brand new password"

    test "updates the password and logs the user in again", %{conn: conn, user: user} do
      conn = log_in_user(conn, user)
      old_token = get_session(conn, :user_token)

      conn =
        post(conn, ~p"/users/update-password", %{
          "user" => %{
            "email" => user.email,
            "password" => @new_password,
            "password_confirmation" => @new_password
          }
        })

      assert redirected_to(conn) == ~p"/users/settings"
      assert Phoenix.Flash.get(conn.assigns.flash, :info) == "Lösenordet är ändrat."
      assert get_session(conn, :user_token) != old_token
      refute Accounts.get_user_by_session_token(old_token)
      assert Accounts.get_user_by_email_and_password(user.email, @new_password)
    end

    test "asks for reauthentication when sudo mode has expired", %{conn: conn, user: user} do
      twenty_one_minutes_ago = DateTime.add(DateTime.utc_now(:second), -21, :minute)
      conn = log_in_user(conn, user, token_authenticated_at: twenty_one_minutes_ago)
      token = get_session(conn, :user_token)

      conn =
        post(conn, ~p"/users/update-password", %{
          "user" => %{
            "email" => user.email,
            "password" => @new_password,
            "password_confirmation" => @new_password
          }
        })

      assert redirected_to(conn) == ~p"/users/log-in"

      assert Phoenix.Flash.get(conn.assigns.flash, :error) ==
               "Du måste logga in igen för att se den här sidan."

      assert get_session(conn, :user_return_to) == ~p"/users/settings"
      refute Accounts.get_user_by_email_and_password(user.email, @new_password)
      # The session is kept so the user can reauthenticate.
      assert Accounts.get_user_by_session_token(token)
    end

    test "redirects back to settings with an error for invalid data", %{conn: conn, user: user} do
      conn = log_in_user(conn, user)
      token = get_session(conn, :user_token)

      conn =
        post(conn, ~p"/users/update-password", %{
          "user" => %{
            "email" => user.email,
            "password" => "short",
            "password_confirmation" => "different"
          }
        })

      assert redirected_to(conn) == ~p"/users/settings"
      assert Phoenix.Flash.get(conn.assigns.flash, :error) =~ "Lösenordet kunde inte ändras"
      refute Accounts.get_user_by_email_and_password(user.email, "short")
      # Failed attempts must not revoke the user's sessions.
      assert Accounts.get_user_by_session_token(token)
    end

    test "rejects a password over 72 bytes", %{conn: conn, user: user} do
      conn = log_in_user(conn, user)
      multi_byte = String.duplicate("å", 40)

      conn =
        post(conn, ~p"/users/update-password", %{
          "user" => %{"password" => multi_byte, "password_confirmation" => multi_byte}
        })

      assert redirected_to(conn) == ~p"/users/settings"
      assert Phoenix.Flash.get(conn.assigns.flash, :error) =~ "Lösenordet kunde inte ändras"
      refute Accounts.get_user_by_email_and_password(user.email, multi_byte)
    end

    test "redirects to login when not logged in", %{conn: conn} do
      conn = post(conn, ~p"/users/update-password", %{"user" => %{"password" => @new_password}})
      assert redirected_to(conn) == ~p"/users/log-in"
    end
  end

  describe "DELETE /users/log-out" do
    test "logs the user out", %{conn: conn, user: user} do
      conn = conn |> log_in_user(user) |> delete(~p"/users/log-out")
      assert redirected_to(conn) == ~p"/"
      refute get_session(conn, :user_token)
      assert Phoenix.Flash.get(conn.assigns.flash, :info) =~ "Du är utloggad"
    end

    test "succeeds even if the user is not logged in", %{conn: conn} do
      conn = delete(conn, ~p"/users/log-out")
      assert redirected_to(conn) == ~p"/"
      refute get_session(conn, :user_token)
      assert Phoenix.Flash.get(conn.assigns.flash, :info) =~ "Du är utloggad"
    end
  end
end
