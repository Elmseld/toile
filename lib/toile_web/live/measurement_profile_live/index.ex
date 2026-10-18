defmodule ToileWeb.MeasurementProfileLive.Index do
  use ToileWeb, :live_view

  alias Toile.Measurements

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope}>
      <.header>
        Listing Measurement profiles
        <:actions>
          <.button variant="primary" navigate={~p"/measurements/new"}>
            <.icon name="hero-plus" /> New Measurement profile
          </.button>
        </:actions>
      </.header>

      <.table
        id="measurement_profiles"
        rows={@streams.measurement_profiles}
        row_click={
          fn {_id, measurement_profile} -> JS.navigate(~p"/measurements/#{measurement_profile}") end
        }
      >
        <:col :let={{_id, measurement_profile}} label="Name">{measurement_profile.name}</:col>
        <:action :let={{_id, measurement_profile}}>
          <div class="sr-only">
            <.link navigate={~p"/measurements/#{measurement_profile}"}>Show</.link>
          </div>
          <.link navigate={~p"/measurements/#{measurement_profile}/edit"}>Edit</.link>
        </:action>
        <:action :let={{id, measurement_profile}}>
          <.link
            phx-click={JS.push("delete", value: %{id: measurement_profile.id}) |> hide("##{id}")}
            data-confirm="Are you sure?"
          >
            Delete
          </.link>
        </:action>
      </.table>
    </Layouts.app>
    """
  end

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket) do
      Measurements.subscribe_measurement_profiles(socket.assigns.current_scope)
    end

    {:ok,
     socket
     |> assign(:page_title, "Listing Measurement profiles")
     |> stream(:measurement_profiles, list_measurement_profiles(socket.assigns.current_scope))}
  end

  @impl true
  def handle_event("delete", %{"id" => id}, socket) do
    measurement_profile = Measurements.get_measurement_profile!(socket.assigns.current_scope, id)

    {:ok, _} =
      Measurements.delete_measurement_profile(socket.assigns.current_scope, measurement_profile)

    {:noreply, stream_delete(socket, :measurement_profiles, measurement_profile)}
  end

  @impl true
  def handle_info({type, %Toile.Measurements.MeasurementProfile{}}, socket)
      when type in [:created, :updated, :deleted] do
    {:noreply,
     stream(
       socket,
       :measurement_profiles,
       list_measurement_profiles(socket.assigns.current_scope),
       reset: true
     )}
  end

  defp list_measurement_profiles(current_scope) do
    Measurements.list_measurement_profiles(current_scope)
  end
end
