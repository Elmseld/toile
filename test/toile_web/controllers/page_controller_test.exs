defmodule ToileWeb.PageControllerTest do
  use ToileWeb.ConnCase, async: true

  import Toile.AccountsFixtures

  describe "GET /" do
    test "renders the Toile description for logged-out visitors", %{conn: conn} do
      conn = get(conn, ~p"/")
      document = conn |> html_response(200) |> LazyHTML.from_document()

      refute Enum.empty?(LazyHTML.query(document, "#landing"))

      assert document |> LazyHTML.query("#landing-register") |> LazyHTML.attribute("href") ==
               [~p"/users/register"]

      assert document |> LazyHTML.query("#landing-log-in") |> LazyHTML.attribute("href") ==
               [~p"/users/log-in"]
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
