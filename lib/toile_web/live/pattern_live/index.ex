defmodule ToileWeb.PatternLive.Index do
  @moduledoc """
  "Mina mönster": the start page for logged-in users, listing their pattern projects.

  Mounted in the `:require_authenticated_user` live_session, so `@current_scope` always holds a
  user. Each row shows the project name, the block it was created from and its measurement
  profile (or that it has none). The list is a stream; since streams are not enumerable,
  `@projects_empty?` tracks whether to show the empty state. The view subscribes to the user's
  project topic and reloads the list on every change.
  """
  use ToileWeb, :live_view

  alias Toile.Patterns
  alias Toile.Patterns.PatternProject
  alias ToileWeb.BlockTexts

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope} list>
      <section id="my-patterns">
        <.header>
          {gettext("My patterns")}
          <:actions>
            <.button
              id="new-pattern"
              class="btn btn-primary btn-lg min-h-11"
              navigate={~p"/patterns/new"}
            >
              <.icon name="hero-plus" /> {gettext("New pattern")}
            </.button>
          </:actions>
        </.header>

        <div :if={@projects_empty?} id="patterns-empty">
          <p>{gettext("You don't have any patterns yet.")}</p>
        </div>

        <%!-- The table scrolls inside its box on narrow screens instead of widening the page. --%>
        <div :if={!@projects_empty?} class="overflow-x-auto">
          <.table
            id="pattern_projects"
            rows={@streams.pattern_projects}
            row_click={fn {_id, project} -> JS.navigate(~p"/patterns/#{project}") end}
          >
            <:col :let={{_id, project}} label={gettext("Name")}>{project.name}</:col>
            <:col :let={{id, project}} label={gettext("Block")}>
              <span id={"#{id}-block"}>{BlockTexts.project_label(project.block)}</span>
            </:col>
            <:col :let={{id, project}} label={gettext("Measurement profile")}>
              <.profile_name id={"#{id}-profile"} profile={project.measurement_profile} />
            </:col>
            <:action :let={{_id, project}}>
              <.link navigate={~p"/patterns/#{project}"} class="btn btn-ghost min-h-11">
                {gettext("Open")}
              </.link>
            </:action>
            <:action :let={{_id, project}}>
              <.link navigate={~p"/patterns/#{project}/edit"} class="btn btn-ghost min-h-11">
                {gettext("Rename")}
              </.link>
            </:action>
            <:action :let={{id, project}}>
              <button
                type="button"
                class="btn btn-ghost min-h-11 text-error"
                phx-click={JS.push("delete", value: %{id: project.id}) |> hide("##{id}")}
                data-confirm={gettext("Delete this pattern?")}
              >
                {gettext("Delete")}
              </button>
            </:action>
          </.table>
        </div>
      </section>
    </Layouts.app>
    """
  end

  attr :id, :string, required: true
  attr :profile, :any, default: nil

  defp profile_name(%{profile: nil} = assigns) do
    ~H"""
    <span id={@id} class="badge badge-warning">{gettext("No measurement profile")}</span>
    """
  end

  defp profile_name(assigns) do
    ~H"""
    <span id={@id}>{@profile.name}</span>
    """
  end

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket) do
      Patterns.subscribe_pattern_projects(socket.assigns.current_scope)
    end

    {:ok,
     socket
     |> assign(:page_title, gettext("My patterns"))
     |> load_projects()}
  end

  @impl true
  def handle_event("delete", %{"id" => id}, socket) do
    scope = socket.assigns.current_scope
    project = Patterns.get_pattern_project!(scope, id)
    {:ok, _} = Patterns.delete_pattern_project(scope, project)

    # The list reloads from the `{:deleted, _}` broadcast in `handle_info/2`.
    {:noreply, put_flash(socket, :info, gettext("Pattern deleted"))}
  end

  @impl true
  def handle_info({type, %PatternProject{}}, socket)
      when type in [:created, :updated, :deleted] do
    {:noreply, load_projects(socket)}
  end

  defp load_projects(socket) do
    projects = Patterns.list_pattern_projects(socket.assigns.current_scope)

    socket
    |> assign(:projects_empty?, projects == [])
    |> stream(:pattern_projects, projects, reset: true)
  end
end
