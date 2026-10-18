defmodule ToileWeb.MeasurementProfileLive.Form do
  use ToileWeb, :live_view

  alias Toile.Measurements
  alias Toile.Measurements.MeasurementProfile

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope}>
      <.header>
        {@page_title}
        <:subtitle>Use this form to manage measurement_profile records in your database.</:subtitle>
      </.header>

      <.form for={@form} id="measurement_profile-form" phx-change="validate" phx-submit="save">
        <.input field={@form[:name]} type="text" label="Name" />
        <footer>
          <.button phx-disable-with="Saving..." variant="primary">Save Measurement profile</.button>
          <.button navigate={return_path(@current_scope, @return_to, @measurement_profile)}>Cancel</.button>
        </footer>
      </.form>
    </Layouts.app>
    """
  end

  @impl true
  def mount(params, _session, socket) do
    {:ok,
     socket
     |> assign(:return_to, return_to(params["return_to"]))
     |> apply_action(socket.assigns.live_action, params)}
  end

  defp return_to("show"), do: "show"
  defp return_to(_), do: "index"

  defp apply_action(socket, :edit, %{"id" => id}) do
    measurement_profile = Measurements.get_measurement_profile!(socket.assigns.current_scope, id)

    socket
    |> assign(:page_title, "Edit Measurement profile")
    |> assign(:measurement_profile, measurement_profile)
    |> assign(
      :form,
      to_form(
        Measurements.change_measurement_profile(socket.assigns.current_scope, measurement_profile)
      )
    )
  end

  defp apply_action(socket, :new, _params) do
    measurement_profile = %MeasurementProfile{user_id: socket.assigns.current_scope.user.id}

    socket
    |> assign(:page_title, "New Measurement profile")
    |> assign(:measurement_profile, measurement_profile)
    |> assign(
      :form,
      to_form(
        Measurements.change_measurement_profile(socket.assigns.current_scope, measurement_profile)
      )
    )
  end

  @impl true
  def handle_event("validate", %{"measurement_profile" => measurement_profile_params}, socket) do
    changeset =
      Measurements.change_measurement_profile(
        socket.assigns.current_scope,
        socket.assigns.measurement_profile,
        measurement_profile_params
      )

    {:noreply, assign(socket, form: to_form(changeset, action: :validate))}
  end

  def handle_event("save", %{"measurement_profile" => measurement_profile_params}, socket) do
    save_measurement_profile(socket, socket.assigns.live_action, measurement_profile_params)
  end

  defp save_measurement_profile(socket, :edit, measurement_profile_params) do
    case Measurements.update_measurement_profile(
           socket.assigns.current_scope,
           socket.assigns.measurement_profile,
           measurement_profile_params
         ) do
      {:ok, measurement_profile} ->
        {:noreply,
         socket
         |> put_flash(:info, "Measurement profile updated successfully")
         |> push_navigate(
           to:
             return_path(
               socket.assigns.current_scope,
               socket.assigns.return_to,
               measurement_profile
             )
         )}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end

  defp save_measurement_profile(socket, :new, measurement_profile_params) do
    case Measurements.create_measurement_profile(
           socket.assigns.current_scope,
           measurement_profile_params
         ) do
      {:ok, measurement_profile} ->
        {:noreply,
         socket
         |> put_flash(:info, "Measurement profile created successfully")
         |> push_navigate(
           to:
             return_path(
               socket.assigns.current_scope,
               socket.assigns.return_to,
               measurement_profile
             )
         )}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end

  defp return_path(_scope, "index", _measurement_profile), do: ~p"/measurements"

  defp return_path(_scope, "show", measurement_profile),
    do: ~p"/measurements/#{measurement_profile}"
end
