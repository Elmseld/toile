defmodule ToileWeb.PageControllerTest do
  use ToileWeb.ConnCase, async: true

  import Toile.AccountsFixtures

  describe "GET /" do
    test "renders the start page for logged-out visitors", %{conn: conn} do
      conn = get(conn, ~p"/")
      assert html_response(conn, 200)
    end

    test "redirects logged-in users to Mina mönster", %{conn: conn} do
      conn =
        conn
        |> log_in_user(user_fixture())
        |> get(~p"/")

      assert redirected_to(conn) == ~p"/patterns"
    end
  end
end
