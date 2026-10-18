defmodule ToileWeb.LayoutsTest do
  use ToileWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  describe "header for logged-out visitors" do
    test "links to log in and register, not to user pages", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/users/log-in")

      assert has_element?(view, ~s(#nav-home[href="/"]))
      assert has_element?(view, ~s(#nav-log-in[href="/users/log-in"]), "Log in")
      assert has_element?(view, ~s(#nav-register[href="/users/register"]), "Register")
      refute has_element?(view, "#nav-my-patterns")
      refute has_element?(view, "#nav-measurements")
      refute has_element?(view, "#nav-settings")
      refute has_element?(view, "#nav-log-out")
    end

    test "has no Phoenix placeholder links on the start page", %{conn: conn} do
      html = conn |> get(~p"/") |> html_response(200)

      refute html =~ "phoenixframework.org"
      refute html =~ "Get Started"
      refute html =~ "Phoenix Framework"
    end
  end

  describe "header for logged-in users" do
    setup :register_and_log_in_user

    test "links to My patterns, Measurements, Settings and Log out", %{conn: conn, user: user} do
      {:ok, view, _html} = live(conn, ~p"/patterns")

      assert has_element?(view, ~s(#nav-my-patterns[href="/patterns"]), "My patterns")
      assert has_element?(view, ~s(#nav-measurements[href="/measurements"]), "Measurements")
      assert has_element?(view, ~s(#nav-settings[href="/users/settings"]), "Settings")

      assert has_element?(
               view,
               ~s(#nav-log-out[href="/users/log-out"][data-method="delete"]),
               "Log out"
             )

      assert has_element?(view, "header", user.email)
      refute has_element?(view, "#nav-log-in")
      refute has_element?(view, "#nav-register")
    end
  end
end
