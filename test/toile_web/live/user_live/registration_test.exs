defmodule ToileWeb.UserLive.RegistrationTest do
  use ToileWeb.ConnCase, async: true

  import Phoenix.LiveViewTest
  import Swoosh.TestAssertions
  import Toile.AccountsFixtures

  alias Toile.Accounts

  describe "Registration page" do
    test "renders registration page", %{conn: conn} do
      {:ok, _lv, html} = live(conn, ~p"/users/register")

      assert html =~ "Create an account"
      assert html =~ "Log in"
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

      assert result =~ "Create an account"
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
               ~r/We have sent an email to .*\. Open the link in the email to confirm your account/
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
        "We have sent an email to #{email}. Open the link in the email to confirm your account."
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

  describe "register user - rate limit" do
    defp register(conn, email) do
      {:ok, lv, _html} = live(conn, ~p"/users/register")

      lv
      |> form("#registration_form", user: %{"email" => email})
      |> render_submit()

      assert_redirect(lv)
    end

    defp expected_flash(email) do
      "We have sent an email to #{email}. Open the link in the email to confirm your account."
    end

    test "over the IP limit creates the account, sends nothing and responds the same",
         %{conn: conn, remote_ip: remote_ip} do
      under_email = unique_user_email()
      under = register(conn, under_email)
      assert_email_sent(to: under_email, subject: "Confirm your account on Toile")

      # The registration used one email of the IP budget; unknown login
      # addresses use up the rest.
      for _ <- 1..19 do
        :ok =
          Accounts.request_login_instructions(unique_user_email(), &"http://x/#{&1}",
            remote_ip: remote_ip
          )
      end

      over_email = unique_user_email()
      over = register(conn, over_email)

      assert_no_email_sent()
      assert %Toile.Accounts.User{} = Accounts.get_user_by_email(over_email)
      assert under == {~p"/users/log-in", %{"info" => expected_flash(under_email)}}
      assert over == {~p"/users/log-in", %{"info" => expected_flash(over_email)}}
    end

    test "sends at most 3 notices for a taken address and responds the same", %{conn: conn} do
      %{email: email} = user_fixture()
      assert_email_sent()

      under =
        for _ <- 1..3 do
          response = register(conn, email)
          assert_email_sent(to: email, subject: "Someone tried to create an account on Toile")
          response
        end

      over = register(conn, email)

      assert_no_email_sent()
      assert Enum.uniq([over | under]) == [over]
      assert over == {~p"/users/log-in", %{"info" => expected_flash(email)}}
    end
  end

  describe "malformed submits" do
    for {name, params} <- [
          {"no user params", %{}},
          {"non-map user", %{"user" => "a@example.com"}},
          {"non-string email", %{"user" => %{"email" => %{"a" => "b"}}}}
        ] do
      test "save renders errors instead of crashing for #{name}", %{conn: conn} do
        {:ok, lv, _html} = live(conn, ~p"/users/register")

        assert render_hook(lv, "save", unquote(Macro.escape(params))) =~ "Create an account"
        refute_received {:email, _}
      end

      test "validate renders errors instead of crashing for #{name}", %{conn: conn} do
        {:ok, lv, _html} = live(conn, ~p"/users/register")

        assert render_hook(lv, "validate", unquote(Macro.escape(params))) =~ "Create an account"
      end
    end
  end

  describe "registration navigation" do
    test "redirects to login page when the Log in button is clicked", %{conn: conn} do
      {:ok, lv, _html} = live(conn, ~p"/users/register")

      {:ok, _login_live, login_html} =
        lv
        |> element("main a", "Log in")
        |> render_click()
        |> follow_redirect(conn, ~p"/users/log-in")

      assert login_html =~ "Log in with email"
    end
  end
end
