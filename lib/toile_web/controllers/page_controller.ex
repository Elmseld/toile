defmodule ToileWeb.PageController do
  use ToileWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
