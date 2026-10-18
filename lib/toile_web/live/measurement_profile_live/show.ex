defmodule ToileWeb.MeasurementProfileLive.Show do
  @moduledoc """
  One measurement profile of the current user: every catalogue measurement, in catalogue
  order, with its value in cm or a "Missing" marker.

  Another user's profile id raises `Ecto.NoResultsError` (404) through the scoped context.
  """
  use ToileWeb, :live_view

  alias Toile.Measurements
  alias Toile.Measurements.MeasurementProfile
  alias ToileWeb.Centimeters
  alias ToileWeb.MeasurementTexts

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope}>
      <.header>
        {@measurement_profile.name}
        <:actions>
          <div class="flex gap-2">
            <.button id="back-to-measurements" navigate={~p"/measurements"}>
              <.icon name="hero-arrow-left" /> {gettext("Back")}
            </.button>
            <.button
              id="edit-measurement-profile"
              variant="primary"
              navigate={~p"/measurements/#{@measurement_profile}/edit?return_to=show"}
            >
              <.icon name="hero-pencil-square" /> {gettext("Edit")}
            </.button>
          </div>
        </:actions>
      </.header>

      <ul id="measurements" class="list">
        <li :for={key <- @keys} id={"measurement-#{key}"} class="list-row items-center">
          <span class="list-col-grow">{MeasurementTexts.label(key)}</span>
          <.measurement_value key={key} mm={Map.fetch!(@measurement_profile.measurements, key)} />
        </li>
      </ul>
    </Layouts.app>
    """
  end

  attr :key, :atom, required: true
  attr :mm, :integer, default: nil

  defp measurement_value(%{mm: nil} = assigns) do
    ~H"""
    <span id={"measurement-#{@key}-missing"} class="badge badge-warning">{gettext("Missing")}</span>
    """
  end

  defp measurement_value(assigns) do
    ~H"""
    <span id={"measurement-#{@key}-value"} class="font-semibold tabular-nums">
      {Centimeters.format(@mm)} cm
    </span>
    """
  end

  @impl true
  def mount(%{"id" => id}, _session, socket) do
    if connected?(socket) do
      Measurements.subscribe_measurement_profiles(socket.assigns.current_scope)
    end

    profile = Measurements.get_measurement_profile!(socket.assigns.current_scope, id)

    {:ok,
     socket
     |> assign(:keys, Measurements.keys())
     |> assign_profile(profile)}
  end

  @impl true
  def handle_info(
        {:updated, %MeasurementProfile{id: id} = profile},
        %{assigns: %{measurement_profile: %{id: id}}} = socket
      ) do
    {:noreply, assign_profile(socket, profile)}
  end

  def handle_info(
        {:deleted, %MeasurementProfile{id: id}},
        %{assigns: %{measurement_profile: %{id: id}}} = socket
      ) do
    {:noreply,
     socket
     |> put_flash(:info, gettext("Measurement profile deleted"))
     |> push_navigate(to: ~p"/measurements")}
  end

  def handle_info({type, %MeasurementProfile{}}, socket)
      when type in [:created, :updated, :deleted] do
    {:noreply, socket}
  end

  defp assign_profile(socket, profile) do
    socket
    |> assign(:page_title, profile.name)
    |> assign(:measurement_profile, profile)
  end
end
