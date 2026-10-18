defmodule ToileWeb.MeasurementProfileLive.Show do
  use ToileWeb, :live_view

  alias Toile.Measurements

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope}>
      <.header>
        Measurement profile {@measurement_profile.id}
        <:subtitle>This is a measurement_profile record from your database.</:subtitle>
        <:actions>
          <.button navigate={~p"/measurements"}>
            <.icon name="hero-arrow-left" />
          </.button>
          <.button
            variant="primary"
            navigate={~p"/measurements/#{@measurement_profile}/edit?return_to=show"}
          >
            <.icon name="hero-pencil-square" /> Edit measurement_profile
          </.button>
        </:actions>
      </.header>

      <.list>
        <:item title="Name">{@measurement_profile.name}</:item>
      </.list>
    </Layouts.app>
    """
  end

  @impl true
  def mount(%{"id" => id}, _session, socket) do
    if connected?(socket) do
      Measurements.subscribe_measurement_profiles(socket.assigns.current_scope)
    end

    {:ok,
     socket
     |> assign(:page_title, "Show Measurement profile")
     |> assign(
       :measurement_profile,
       Measurements.get_measurement_profile!(socket.assigns.current_scope, id)
     )}
  end

  @impl true
  def handle_info(
        {:updated, %Toile.Measurements.MeasurementProfile{id: id} = measurement_profile},
        %{assigns: %{measurement_profile: %{id: id}}} = socket
      ) do
    {:noreply, assign(socket, :measurement_profile, measurement_profile)}
  end

  def handle_info(
        {:deleted, %Toile.Measurements.MeasurementProfile{id: id}},
        %{assigns: %{measurement_profile: %{id: id}}} = socket
      ) do
    {:noreply,
     socket
     |> put_flash(:error, "The current measurement_profile was deleted.")
     |> push_navigate(to: ~p"/measurements")}
  end

  def handle_info({type, %Toile.Measurements.MeasurementProfile{}}, socket)
      when type in [:created, :updated, :deleted] do
    {:noreply, socket}
  end
end
