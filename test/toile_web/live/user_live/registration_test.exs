defmodule ToileWeb.UserLive.RegistrationTest do
  use ToileWeb.ConnCase, async: true

  import Phoenix.LiveViewTest
  import Toile.AccountsFixtures

  alias Toile.Accounts

  describe "Registration page" do
    test "renders registration page", %{conn: conn} do
      {:ok, _lv, html} = live(conn, ~p"/users/register")

      assert html =~ "Skapa ett konto"
      assert html =~ "Logga in"
    end

    test "redirects if already logged in", %{conn: conn} do
      result =
        conn
        |> log_in_user(user_fixture())
        |> live(~p"/users/register")
        |> follow_redirect(conn, ~p"/")

      assert {:ok, _conn} = result
    end

    test "renders errors for invalid data", %{conn: conn} do
      {:ok, lv, _html} = live(conn, ~p"/users/register")

      result =
        lv
        |> element("#registration_form")
        |> render_change(user: %{"email" => "with spaces"})

      assert result =~ "Skapa ett konto"
      assert result =~ "must have the @ sign and no spaces"
    end
  end

  describe "register user" do
    test "creates account but does not log in", %{conn: conn} do
      {:ok, lv, _html} = live(conn, ~p"/users/register")

      email = unique_user_email()
      form = form(lv, "#registration_form", user: valid_user_attributes(email: email))

      {:ok, _lv, html} =
        render_submit(form)
        |> follow_redirect(conn, ~p"/users/log-in")

      assert html =~
               ~r/Vi har skickat ett mejl till .*\. Öppna länken i mejlet för att bekräfta ditt konto/
    end

    test "responds to a taken email exactly as to a new one", %{conn: conn} do
      user = user_fixture()
      new_email = unique_user_email()

      submit = fn email ->
        {:ok, lv, _html} = live(conn, ~p"/users/register")

        {:ok, login_lv, _html} =
          lv
          |> form("#registration_form", user: %{"email" => email})
          |> render_submit()
          |> follow_redirect(conn, ~p"/users/log-in")

        login_lv
        |> render()
        |> LazyHTML.from_fragment()
        |> LazyHTML.query("#flash-info")
        |> LazyHTML.text()
      end

      taken_flash = submit.(user.email)
      new_flash = submit.(new_email)

      expected = fn email ->
        "Vi har skickat ett mejl till #{email}. Öppna länken i mejlet för att bekräfta ditt konto."
      end

      assert taken_flash =~ expected.(user.email)
      assert new_flash =~ expected.(new_email)

      assert String.replace(taken_flash, user.email, "") ==
               String.replace(new_flash, new_email, "")

      assert Accounts.get_user_by_email(new_email)
    end

    test "still renders other validation errors on submit", %{conn: conn} do
      {:ok, lv, _html} = live(conn, ~p"/users/register")

      result =
        lv
        |> form("#registration_form", user: %{"email" => "with spaces"})
        |> render_submit()

      assert result =~ "must have the @ sign and no spaces"
    end
  end

  describe "registration navigation" do
    test "redirects to login page when the Log in button is clicked", %{conn: conn} do
      {:ok, lv, _html} = live(conn, ~p"/users/register")

      {:ok, _login_live, login_html} =
        lv
        |> element("main a", "Logga in")
        |> render_click()
        |> follow_redirect(conn, ~p"/users/log-in")

      assert login_html =~ "Logga in med e-post"
    end
  end
end
