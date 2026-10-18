defmodule ToileWeb.MeasurementProfileLive.Index do
  @moduledoc """
  "Mått": the list of the current user's measurement profiles.

  Each row shows the profile name and how many measurements are missing (or that it is
  complete). The list is a stream; since streams are not enumerable, `@profiles_empty?`
  tracks whether to show the empty state. The view subscribes to the user's profile topic and
  reloads the list on every change.
  """
  use ToileWeb, :live_view

  alias Toile.Measurements
  alias Toile.Measurements.MeasurementProfile

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope}>
      <.header>
        {gettext("Measurements")}
        <:actions>
          <.button
            id="new-measurement-profile"
            class="btn btn-primary btn-lg"
            navigate={~p"/measurements/new"}
          >
            <.icon name="hero-plus" /> {gettext("New measurement profile")}
          </.button>
        </:actions>
      </.header>

      <p :if={@profiles_empty?} id="measurement-profiles-empty">
        {gettext("You don't have any measurement profiles yet.")}
      </p>

      <.table
        :if={!@profiles_empty?}
        id="measurement_profiles"
        rows={@streams.measurement_profiles}
        row_click={fn {_id, profile} -> JS.navigate(~p"/measurements/#{profile}") end}
      >
        <:col :let={{_id, profile}} label={gettext("Name")}>{profile.name}</:col>
        <:col :let={{id, profile}} label={gettext("Measurements")}>
          <.missing_status
            id={"#{id}-status"}
            missing={length(Measurements.missing_measurements(profile))}
          />
        </:col>
        <:action :let={{_id, profile}}>
          <.link navigate={~p"/measurements/#{profile}"} class="btn btn-ghost">
            {gettext("Show")}
          </.link>
        </:action>
        <:action :let={{_id, profile}}>
          <.link navigate={~p"/measurements/#{profile}/edit"} class="btn btn-ghost">
            {gettext("Edit")}
          </.link>
        </:action>
        <:action :let={{id, profile}}>
          <button
            type="button"
            class="btn btn-ghost text-error"
            phx-click={JS.push("delete", value: %{id: profile.id}) |> hide("##{id}")}
            data-confirm={gettext("Delete this measurement profile?")}
          >
            {gettext("Delete")}
          </button>
        </:action>
      </.table>
    </Layouts.app>
    """
  end

  attr :id, :string, required: true
  attr :missing, :integer, required: true

  defp missing_status(%{missing: 0} = assigns) do
    ~H"""
    <span id={@id} class="badge badge-success">{gettext("Complete")}</span>
    """
  end

  defp missing_status(assigns) do
    ~H"""
    <span id={@id} class="badge badge-warning">
      {ngettext("1 measurement missing", "%{count} measurements missing", @missing)}
    </span>
    """
  end

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket) do
      Measurements.subscribe_measurement_profiles(socket.assigns.current_scope)
    end

    {:ok,
     socket
     |> assign(:page_title, gettext("Measurements"))
     |> load_profiles()}
  end

  @impl true
  def handle_event("delete", %{"id" => id}, socket) do
    scope = socket.assigns.current_scope
    profile = Measurements.get_measurement_profile!(scope, id)
    {:ok, _} = Measurements.delete_measurement_profile(scope, profile)

    # The list reloads from the `{:deleted, _}` broadcast in `handle_info/2`.
    {:noreply, put_flash(socket, :info, gettext("Measurement profile deleted"))}
  end

  @impl true
  def handle_info({type, %MeasurementProfile{}}, socket)
      when type in [:created, :updated, :deleted] do
    {:noreply, load_profiles(socket)}
  end

  defp load_profiles(socket) do
    profiles = Measurements.list_measurement_profiles(socket.assigns.current_scope)

    socket
    |> assign(:profiles_empty?, profiles == [])
    |> stream(:measurement_profiles, profiles, reset: true)
  end
end
