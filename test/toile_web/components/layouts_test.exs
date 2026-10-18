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

      # The email is hidden below lg and truncated so the header never scrolls sideways on a
      # tablet; the full address stays available as a tooltip.
      assert has_element?(
               view,
               ~s(#nav-user-email.hidden.lg\\:block.truncate[title="#{user.email}"]),
               user.email
             )

      assert has_element?(view, "header nav.min-w-0 > ul.flex-wrap")
      refute has_element?(view, "#nav-log-in")
      refute has_element?(view, "#nav-register")
    end
  end

  describe "content width" do
    test "is narrow by default and wide on request" do
      narrow = render_component(&ToileWeb.Layouts.app/1, flash: %{}, inner_block: slot("x"))

      wide =
        render_component(&ToileWeb.Layouts.app/1, flash: %{}, wide: true, inner_block: slot("x"))

      assert narrow =~ ~r/id="main-content" class="[^"]*max-w-2xl/
      refute narrow =~ "max-w-7xl"
      assert wide =~ ~r/id="main-content" class="[^"]*max-w-7xl/
      refute wide =~ "max-w-2xl"
    end
  end

  defp slot(text), do: [%{__slot__: :inner_block, inner_block: fn _, _ -> text end}]
end
