defmodule ToileWeb.PatternLive.IndexTest do
  use ToileWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  describe "logged out" do
    test "redirects to the login page with an error flash", %{conn: conn} do
      assert {:error, {:redirect, %{to: path, flash: flash}}} = live(conn, ~p"/patterns")
      assert path == ~p"/users/log-in"
      assert %{"error" => _} = flash
    end

    test "returns to /patterns after login", %{conn: conn} do
      conn = get(conn, ~p"/patterns")
      assert redirected_to(conn) == ~p"/users/log-in"
      assert get_session(conn, :user_return_to) == ~p"/patterns"
    end
  end

  describe "logged in" do
    setup :register_and_log_in_user

    test "shows the heading and the empty state", %{conn: conn} do
      {:ok, view, html} = live(conn, ~p"/patterns")

      assert has_element?(view, "#my-patterns h1", "Mina mönster")
      assert has_element?(view, "#patterns-empty")
      assert html =~ "Mina mönster"
    end
  end
end
