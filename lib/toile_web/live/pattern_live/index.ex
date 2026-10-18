defmodule ToileWeb.PatternLive.Index do
  @moduledoc """
  "Mina mönster": the start page for logged-in users.

  Mounted in the `:require_authenticated_user` live_session, so
  `@current_scope` always holds a user. It shows an empty state for now;
  ticket 0005 adds the list of the user's pattern projects, loaded through
  the scope.
  """
  use ToileWeb, :live_view

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope}>
      <section id="my-patterns">
        <.header>{gettext("My patterns")}</.header>

        <div id="patterns-empty">
          <p>{gettext("You don't have any patterns yet.")}</p>
        </div>
      </section>
    </Layouts.app>
    """
  end

  @impl true
  def mount(_params, _session, socket) do
    {:ok, assign(socket, :page_title, gettext("My patterns"))}
  end
end
