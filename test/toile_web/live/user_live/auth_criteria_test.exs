defmodule ToileWeb.AuthCriteriaTest do
  use ToileWeb.ConnCase, async: true

  import Phoenix.LiveViewTest
  import Toile.AccountsFixtures

  test "the user scope is registered as the default scope" do
    scopes = Application.fetch_env!(:toile, :scopes)

    assert [default: true, module: Toile.Accounts.Scope] =
             Keyword.take(scopes[:user], [:default, :module])

    assert scopes[:user][:schema_type] == :binary_id
    assert scopes[:user][:schema_key] == :user_id
  end

  test "wrong password and unknown email give the same response", %{conn: conn} do
    user = user_fixture() |> set_password()

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

  test "magic link request does not reveal whether the email exists", %{conn: conn} do
    {:ok, lv, _} = live(conn, ~p"/users/log-in")

    {:ok, _, html_known} =
      lv
      |> form("#login_form_magic", user: %{email: user_fixture().email})
      |> render_submit()
      |> follow_redirect(conn)

    {:ok, lv, _} = live(build_conn(), ~p"/users/log-in")

    {:ok, _, html_unknown} =
      lv
      |> form("#login_form_magic", user: %{email: "nobody@example.com"})
      |> render_submit()
      |> follow_redirect(build_conn())

    assert html_known =~ "Logga in"
    assert html_unknown =~ "Logga in"
    refute_received {:email, %Swoosh.Email{to: [{_, "nobody@example.com"}]}}
  end

  test "logged-out request to /patterns returns there after login", %{conn: conn} do
    user = user_fixture() |> set_password()
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
