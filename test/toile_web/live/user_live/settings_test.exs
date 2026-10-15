defmodule ToileWeb.UserLive.SettingsTest do
  use ToileWeb.ConnCase, async: true

  alias Toile.Accounts
  import Phoenix.LiveViewTest
  import Swoosh.TestAssertions
  import Toile.AccountsFixtures

  describe "Settings page" do
    test "renders settings page", %{conn: conn} do
      {:ok, _lv, html} =
        conn
        |> log_in_user(user_fixture())
        |> live(~p"/users/settings")

      assert html =~ "Change email"
      assert html =~ "Save password"
    end

    test "redirects if user is not logged in", %{conn: conn} do
      assert {:error, redirect} = live(conn, ~p"/users/settings")

      assert {:redirect, %{to: path, flash: flash}} = redirect
      assert path == ~p"/users/log-in"
      assert %{"error" => "You must log in to access this page."} = flash
    end

    test "redirects if user is not in sudo mode", %{conn: conn} do
      {:ok, conn} =
        conn
        |> log_in_user(user_fixture(),
          token_authenticated_at: DateTime.add(DateTime.utc_now(:second), -11, :minute)
        )
        |> live(~p"/users/settings")
        |> follow_redirect(conn, ~p"/users/log-in")

      assert conn.resp_body =~ "You must log in again to access this page."
    end
  end

  describe "update email form" do
    setup %{conn: conn} do
      user = user_fixture()
      %{conn: log_in_user(conn, user), user: user}
    end

    test "updates the user email", %{conn: conn, user: user} do
      new_email = unique_user_email()

      {:ok, lv, _html} = live(conn, ~p"/users/settings")

      result =
        lv
        |> form("#email_form", %{
          "user" => %{"email" => new_email}
        })
        |> render_submit()

      assert result =~ "We have sent a link to the new address"
      assert Accounts.get_user_by_email(user.email)
    end

    test "gives the same response for a taken address and sends no change link",
         %{conn: conn, user: user} do
      %{email: taken} = user_fixture()
      # Drop the emails sent while creating both fixtures.
      assert_email_sent()
      assert_email_sent()
      free = unique_user_email()
      {:ok, lv, _html} = live(conn, ~p"/users/settings")

      free_result =
        lv
        |> form("#email_form", %{"user" => %{"email" => free}})
        |> render_submit()

      assert_email_sent(subject: "Change your email address for Toile", to: free)

      {:ok, lv, _html} = live(conn, ~p"/users/settings")

      taken_result =
        lv
        |> form("#email_form", %{"user" => %{"email" => taken}})
        |> render_submit()

      for result <- [free_result, taken_result] do
        assert result =~ "We have sent a link to the new address"
        refute result =~ "has already been taken"
      end

      # Only the free address got a change link.
      assert [%{sent_to: ^free}] =
               Toile.Repo.all_by(Accounts.UserToken,
                 user_id: user.id,
                 context: "change:#{user.email}"
               )

      assert_email_sent(
        subject: "Someone tried to use your email address on Toile",
        to: taken
      )

      assert_no_email_sent()
    end

    test "renders errors with invalid data (phx-change)", %{conn: conn} do
      {:ok, lv, _html} = live(conn, ~p"/users/settings")

      result =
        lv
        |> element("#email_form")
        |> render_change(%{
          "action" => "update_email",
          "user" => %{"email" => "with spaces"}
        })

      assert result =~ "Change email"
      assert result =~ "must have the @ sign and no spaces"
    end

    test "renders errors with invalid data (phx-submit)", %{conn: conn, user: user} do
      {:ok, lv, _html} = live(conn, ~p"/users/settings")

      result =
        lv
        |> form("#email_form", %{
          "user" => %{"email" => user.email}
        })
        |> render_submit()

      assert result =~ "Change email"
      assert result =~ "did not change"
    end

    test "redirects to log in when sudo mode expired while the page was open", %{
      conn: conn,
      user: user
    } do
      # Drop the email sent while creating the fixture.
      assert_email_sent()
      {:ok, lv, _html} = live(conn, ~p"/users/settings")
      expire_sudo_mode(lv)

      {:ok, login_conn} =
        lv
        |> form("#email_form", %{"user" => %{"email" => unique_user_email()}})
        |> render_submit()
        |> follow_redirect(conn, ~p"/users/log-in")

      assert login_conn.resp_body =~ "You must log in again to access this page."
      assert Accounts.get_user_by_email(user.email)
      refute_email_sent()
    end
  end

  describe "update password form" do
    setup %{conn: conn} do
      user = user_fixture()
      %{conn: log_in_user(conn, user), user: user}
    end

    test "updates the user password", %{conn: conn, user: user} do
      new_password = valid_user_password()

      {:ok, lv, _html} = live(conn, ~p"/users/settings")

      form =
        form(lv, "#password_form", %{
          "user" => %{
            "email" => user.email,
            "password" => new_password,
            "password_confirmation" => new_password
          }
        })

      render_submit(form)

      new_password_conn = follow_trigger_action(form, conn)

      assert redirected_to(new_password_conn) == ~p"/users/settings"

      assert get_session(new_password_conn, :user_token) != get_session(conn, :user_token)

      assert Phoenix.Flash.get(new_password_conn.assigns.flash, :info) =~
               "Your password has been changed"

      assert Accounts.get_user_by_email_and_password(user.email, new_password)
    end

    test "renders errors with invalid data (phx-change)", %{conn: conn} do
      {:ok, lv, _html} = live(conn, ~p"/users/settings")

      result =
        lv
        |> element("#password_form")
        |> render_change(%{
          "user" => %{
            "password" => "too short",
            "password_confirmation" => "does not match"
          }
        })

      assert result =~ "Save password"
      assert result =~ "should be at least 12 character(s)"
      assert result =~ "does not match password"
    end

    test "renders errors with invalid data (phx-submit)", %{conn: conn} do
      {:ok, lv, _html} = live(conn, ~p"/users/settings")

      result =
        lv
        |> form("#password_form", %{
          "user" => %{
            "password" => "too short",
            "password_confirmation" => "does not match"
          }
        })
        |> render_submit()

      assert result =~ "Save password"
      assert result =~ "should be at least 12 character(s)"
      assert result =~ "does not match password"
    end

    test "redirects to log in when sudo mode expired while the page was open", %{
      conn: conn,
      user: user
    } do
      new_password = valid_user_password()
      {:ok, lv, _html} = live(conn, ~p"/users/settings")
      expire_sudo_mode(lv)

      {:ok, login_conn} =
        lv
        |> form("#password_form", %{
          "user" => %{
            "email" => user.email,
            "password" => new_password,
            "password_confirmation" => new_password
          }
        })
        |> render_submit()
        |> follow_redirect(conn, ~p"/users/log-in")

      assert login_conn.resp_body =~ "You must log in again to access this page."
      refute Accounts.get_user_by_email_and_password(user.email, new_password)
    end
  end

  describe "confirm email" do
    setup %{conn: conn} do
      user = user_fixture()
      email = unique_user_email()

      token =
        extract_user_token(fn url ->
          Accounts.deliver_user_update_email_instructions(%{user | email: email}, user.email, url)
        end)

      %{conn: log_in_user(conn, user), token: token, email: email, user: user}
    end

    test "updates the user email once", %{conn: conn, user: user, token: token, email: email} do
      {:error, redirect} = live(conn, ~p"/users/settings/confirm-email/#{token}")

      assert {:live_redirect, %{to: path, flash: flash}} = redirect
      assert path == ~p"/users/settings"
      assert %{"info" => message} = flash
      assert message == "Your email address has been changed."
      refute Accounts.get_user_by_email(user.email)
      assert Accounts.get_user_by_email(email)

      # use confirm token again
      {:error, redirect} = live(conn, ~p"/users/settings/confirm-email/#{token}")
      assert {:live_redirect, %{to: path, flash: flash}} = redirect
      assert path == ~p"/users/settings"
      assert %{"error" => message} = flash
      assert message == "The link to change your email is invalid or has expired."
    end

    test "does not update email with invalid token", %{conn: conn, user: user} do
      {:error, redirect} = live(conn, ~p"/users/settings/confirm-email/oops")
      assert {:live_redirect, %{to: path, flash: flash}} = redirect
      assert path == ~p"/users/settings"
      assert %{"error" => message} = flash
      assert message == "The link to change your email is invalid or has expired."
      assert Accounts.get_user_by_email(user.email)
    end

    test "returns to the link after reauthenticating when sudo mode has expired", %{
      user: user,
      token: token,
      email: email
    } do
      confirm_path = ~p"/users/settings/confirm-email/#{token}"

      conn =
        build_conn()
        |> log_in_user(user,
          token_authenticated_at: DateTime.add(DateTime.utc_now(:second), -11, :minute)
        )
        |> get(confirm_path)

      assert redirected_to(conn) == ~p"/users/log-in"

      assert Phoenix.Flash.get(conn.assigns.flash, :error) ==
               "You must log in again to access this page."

      assert get_session(conn, :user_return_to) == confirm_path
      assert Accounts.get_user_by_email(user.email)

      # Reauthenticate with a magic link in the same browser session.
      {login_token, _hashed} = generate_user_magic_link_token(user)
      conn = post(conn, ~p"/users/log-in", %{"user" => %{"token" => login_token}})
      assert redirected_to(conn) == confirm_path

      {:error, {:live_redirect, %{to: path, flash: flash}}} = live(conn, confirm_path)
      assert path == ~p"/users/settings"
      assert flash["info"] == "Your email address has been changed."
      refute Accounts.get_user_by_email(user.email)
      assert Accounts.get_user_by_email(email)
    end

    test "redirects if user is not logged in", %{token: token} do
      conn = build_conn()
      {:error, redirect} = live(conn, ~p"/users/settings/confirm-email/#{token}")
      assert {:redirect, %{to: path, flash: flash}} = redirect
      assert path == ~p"/users/log-in"
      assert %{"error" => message} = flash
      assert message == "You must log in to access this page."
    end
  end

  # Simulates the sudo window running out while the settings page stays open by
  # back-dating the user's authentication time in the running LiveView.
  defp expire_sudo_mode(lv) do
    expired_at = DateTime.add(DateTime.utc_now(:second), -21, :minute)

    :sys.replace_state(lv.pid, fn state ->
      update_in(state.socket.assigns.current_scope.user, &%{&1 | authenticated_at: expired_at})
    end)
  end
end
