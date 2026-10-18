defmodule ToileWeb.MeasurementProfileLive.Form do
  @moduledoc """
  Creates (`:new`) or edits (`:edit`) a measurement profile of the current user.

  The user types centimetres (`.` or `,` as decimal separator); `handle_event/3` maps
  `params["measurements"]` through `ToileWeb.Centimeters.to_mm_params/1` before calling the
  context, which stores integer millimetres. Unparseable input is passed through, so the
  schema's integer cast reports the format error and the input keeps what was typed.

  The inputs are built for touch: one field per row, `input-lg` with a 44 px minimum height
  (`min-h-11`, the theme field size alone renders 42 px), `inputmode="decimal"` for the
  numeric keyboard, and large save and cancel buttons of the same minimum height.
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
      <.header>{@page_title}</.header>

      <.form for={@form} id="measurement-profile-form" phx-change="validate" phx-submit="save">
        <.input
          field={@form[:name]}
          label={gettext("Name")}
          class="w-full input input-lg min-h-11"
          autocomplete="off"
          phx-debounce="300"
        />

        <.inputs_for :let={m} field={@form[:measurements]}>
          <div :for={key <- @keys} id={"measurement-field-#{key}"} class="mb-2">
            <.input
              field={m[key]}
              id={"measurement-input-#{key}"}
              type="text"
              inputmode="decimal"
              autocomplete="off"
              phx-debounce="300"
              value={Centimeters.input_value(m[key].value)}
              label={gettext("%{measurement} (cm)", measurement: MeasurementTexts.label(key))}
              class="w-full input input-lg min-h-11"
              aria-describedby={"help-#{key}"}
            />
            <p id={"help-#{key}"} class="-mt-1 text-sm text-base-content/70">
              {MeasurementTexts.help(key)}
            </p>
          </div>
        </.inputs_for>

        <footer class="mt-6 flex flex-wrap gap-2">
          <.button
            id="save-measurement-profile"
            class="btn btn-primary btn-lg min-h-11"
            phx-disable-with={gettext("Saving...")}
          >
            {gettext("Save")}
          </.button>
          <.button
            id="cancel-measurement-profile"
            class="btn btn-ghost btn-lg min-h-11"
            navigate={cancel_path(@return_to, @measurement_profile)}
          >
            {gettext("Cancel")}
          </.button>
        </footer>
      </.form>
    </Layouts.app>
    """
  end

  @impl true
  def mount(params, _session, socket) do
    {:ok,
     socket
     |> assign(:keys, Measurements.keys())
     |> assign(:return_to, return_to(params["return_to"]))
     |> apply_action(socket.assigns.live_action, params)}
  end

  defp return_to("show"), do: "show"
  defp return_to(_), do: "index"

  defp apply_action(socket, :edit, %{"id" => id}) do
    profile = Measurements.get_measurement_profile!(socket.assigns.current_scope, id)

    socket
    |> assign(:page_title, gettext("Edit measurement profile"))
    |> assign_profile(profile)
  end

  defp apply_action(socket, :new, _params) do
    profile = %MeasurementProfile{user_id: socket.assigns.current_scope.user.id}

    socket
    |> assign(:page_title, gettext("New measurement profile"))
    |> assign_profile(profile)
  end

  defp assign_profile(socket, profile) do
    changeset = Measurements.change_measurement_profile(socket.assigns.current_scope, profile)

    socket
    |> assign(:measurement_profile, profile)
    |> assign(:form, to_form(changeset))
  end

  @impl true
  def handle_event("validate", %{"measurement_profile" => params}, socket) do
    changeset =
      Measurements.change_measurement_profile(
        socket.assigns.current_scope,
        socket.assigns.measurement_profile,
        to_mm(params)
      )

    {:noreply, assign(socket, form: to_form(changeset, action: :validate))}
  end

  def handle_event("save", %{"measurement_profile" => params}, socket) do
    save_profile(socket, socket.assigns.live_action, to_mm(params))
  end

  defp to_mm(%{"measurements" => measurements} = params) when is_map(measurements),
    do: %{params | "measurements" => Centimeters.to_mm_params(measurements)}

  defp to_mm(params), do: params

  defp save_profile(socket, :edit, params) do
    scope = socket.assigns.current_scope

    case Measurements.update_measurement_profile(
           scope,
           socket.assigns.measurement_profile,
           params
         ) do
      {:ok, profile} ->
        {:noreply,
         socket
         |> put_flash(:info, gettext("Measurement profile updated"))
         |> push_navigate(to: return_path(socket.assigns.return_to, profile))}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end

  defp save_profile(socket, :new, params) do
    case Measurements.create_measurement_profile(socket.assigns.current_scope, params) do
      {:ok, profile} ->
        {:noreply,
         socket
         |> put_flash(:info, gettext("Measurement profile created"))
         |> push_navigate(to: ~p"/measurements/#{profile}")}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end

  defp return_path("show", profile), do: ~p"/measurements/#{profile}"
  defp return_path("index", _profile), do: ~p"/measurements"

  # A new profile has no page of its own yet, so cancelling goes back to the list.
  defp cancel_path("show", %MeasurementProfile{id: id} = profile) when not is_nil(id),
    do: return_path("show", profile)

  defp cancel_path(_return_to, _profile), do: ~p"/measurements"
end
