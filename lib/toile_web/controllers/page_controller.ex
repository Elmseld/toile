defmodule ToileWeb.PageController do
  use ToileWeb, :controller

  alias Toile.Accounts.{Scope, User}

  @doc """
  The start page. Logged-in users go straight to "Mina mönster";
  logged-out visitors see a short description of Toile.
  """
  def home(conn, _params) do
    case conn.assigns.current_scope do
      %Scope{user: %User{}} -> redirect(conn, to: ~p"/patterns")
      _ -> render(conn, :home)
    end
  end
end
