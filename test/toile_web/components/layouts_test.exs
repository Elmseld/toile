defmodule ToileWeb.LayoutsTest do
  use ToileWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  describe "header for logged-out visitors" do
    test "links to log in and register, not to user pages", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/users/log-in")

      assert has_element?(view, ~s(#nav-home[href="/"]))
      assert has_element?(view, ~s(#nav-log-in[href="/users/log-in"]), "Logga in")
      assert has_element?(view, ~s(#nav-register[href="/users/register"]), "Registrera")
      refute has_element?(view, "#nav-my-patterns")
      refute has_element?(view, "#nav-settings")
      refute has_element?(view, "#nav-log-out")
    end

    test "has no Phoenix placeholder links on the start page", %{conn: conn} do
      html = conn |> get(~p"/") |> html_response(200)

      refute html =~ "phoenixframework.org"
      refute html =~ "Get Started"
      refute html =~ "Phoenix Framework"
      assert html =~ ~s(<html lang="sv")
    end
  end

  describe "Swedish system texts" do
    test "nav and theme toggle have Swedish aria labels", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/users/log-in")

      assert has_element?(view, ~s(nav[aria-label="Huvudmeny"]))
      assert has_element?(view, ~s(button[aria-label="Systemtema"]))
      assert has_element?(view, ~s(button[aria-label="Ljust tema"]))
      assert has_element?(view, ~s(button[aria-label="Mörkt tema"]))
    end

    test "connection error flashes are in Swedish", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/users/log-in")

      assert has_element?(view, "#client-error", "Ingen internetanslutning")
      assert has_element?(view, "#client-error", "Försöker ansluta igen")
      assert has_element?(view, "#server-error", "Något gick fel!")
      assert has_element?(view, "#server-error", "Försöker ansluta igen")
    end

    test "the flash close button has a Swedish aria label", %{conn: conn} do
      {:ok, _view, html} =
        conn
        |> live(~p"/users/log-in/invalid-token")
        |> follow_redirect(conn, ~p"/users/log-in")

      assert html =~ "Inloggningslänken är ogiltig eller har gått ut."
      assert html =~ ~s(aria-label="Stäng")
    end
  end

  describe "header for logged-in users" do
    setup :register_and_log_in_user

    test "links to Mina mönster, Inställningar and Logga ut", %{conn: conn, user: user} do
      {:ok, view, _html} = live(conn, ~p"/patterns")

      assert has_element?(view, ~s(#nav-my-patterns[href="/patterns"]), "Mina mönster")
      assert has_element?(view, ~s(#nav-settings[href="/users/settings"]), "Inställningar")

      assert has_element?(
               view,
               ~s(#nav-log-out[href="/users/log-out"][data-method="delete"]),
               "Logga ut"
             )

      assert has_element?(view, "header", user.email)
      refute has_element?(view, "#nav-log-in")
      refute has_element?(view, "#nav-register")
    end
  end
end
