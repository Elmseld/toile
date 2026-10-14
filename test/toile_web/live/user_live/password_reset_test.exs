defmodule ToileWeb.UserLive.PasswordResetTest do
  @moduledoc """
  End-to-end test of "glömt lösenordet": request a magic link from the
  login page, log in with it, choose a new password under Inställningar,
  then log in with the new password.
  """
  use ToileWeb.ConnCase, async: true

  import Phoenix.LiveViewTest
  import Toile.AccountsFixtures

  alias Toile.Accounts

  @new_password "a brand new password"

  test "a user who forgot the password can log in by email and set a new one", %{conn: conn} do
    user = user_fixture() |> set_password()
    old_password = valid_user_password()

    # user_fixture/0 confirms the user via an email of its own; drop it.
    flush_emails()

    # Another device that is logged in before the reset.
    other_device = log_in_user(build_conn(), user)

    # 1. Request a login link from the login page, which explains the flow.
    {:ok, lv, _html} = live(conn, ~p"/users/log-in")
    assert has_element?(lv, "#forgot-password-hint", "Glömt lösenordet?")

    lv
    |> form("#login_form_magic", user: %{email: user.email})
    |> render_submit()

    assert_received {:email, %Swoosh.Email{to: [{_, to}], text_body: body}}
    assert to == user.email
    assert [_, token] = Regex.run(~r{/users/log-in/([\w-]+)}, body)
    # The email for confirmed users points to Inställningar for a new password.
    assert body =~ "lösenord under Inställningar"

    # 2. Open the link and log in with it.
    {:ok, lv, _html} = live(conn, ~p"/users/log-in/#{token}")
    form = form(lv, "#login_form", %{"user" => %{"token" => token}})
    render_submit(form)
    conn = follow_trigger_action(form, conn)

    assert get_session(conn, :user_token)
    assert redirected_to(conn) == ~p"/"

    # 3. Choose a new password under Inställningar (the fresh login counts as sudo mode).
    {:ok, lv, _html} = live(conn, ~p"/users/settings")

    form =
      form(lv, "#password_form", %{
        "user" => %{
          "email" => user.email,
          "password" => @new_password,
          "password_confirmation" => @new_password
        }
      })

    render_submit(form)
    conn = follow_trigger_action(form, conn)
    assert redirected_to(conn) == ~p"/users/settings"

    # 4. The new password works and the old one does not.
    assert %Accounts.User{id: id} =
             Accounts.get_user_by_email_and_password(user.email, @new_password)

    assert id == user.id
    refute Accounts.get_user_by_email_and_password(user.email, old_password)

    new_login =
      post(build_conn(), ~p"/users/log-in", %{
        "user" => %{"email" => user.email, "password" => @new_password}
      })

    assert get_session(new_login, :user_token)
    assert redirected_to(new_login) == ~p"/"

    old_login =
      post(build_conn(), ~p"/users/log-in", %{
        "user" => %{"email" => user.email, "password" => old_password}
      })

    refute get_session(old_login, :user_token)
    assert redirected_to(old_login) == ~p"/users/log-in"

    # Sessions from before the reset are logged out.
    other_device = get(other_device, ~p"/patterns")
    assert redirected_to(other_device) == ~p"/users/log-in"
  end

  defp flush_emails do
    receive do
      {:email, _} -> flush_emails()
    after
      0 -> :ok
    end
  end
end
