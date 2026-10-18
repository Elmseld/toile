defmodule ToileWeb.PatternLive.Show do
  @moduledoc """
  One pattern project of the current user, drawn to scale.

  The server never computes geometry: it hands the stored definition and the engine input
  (`Toile.Patterns.engine_input/2`) to the `PatternView` hook (`assets/js/hooks/pattern_view.js`)
  in data attributes, and the hook runs the engine in the browser and draws the pieces in SVG
  over a centimetre grid, with zoom and pan.

  Exactly one of three states is rendered:

    * `#no-profile`: the project has no measurement profile (it was deleted); the user picks one.
    * `#missing-measurements`: the profile lacks measurements the definition declares; they are
      listed with a link to edit the profile, and nothing is drawn.
    * `#pattern`: the drawing. The hook element sits in a wrapper keyed by the profile id, so a
      profile switch replaces it and the hook mounts again with the new input.

  Choosing another profile in `#profile-form` saves it on the project. A rejected profile (not
  the user's own) reloads the page with an error, so the select shows the stored profile again.
  Another user's project id raises `Ecto.NoResultsError` (404) through the scoped context.
  """
  use ToileWeb, :live_view

  alias Toile.Measurements
  alias Toile.Patterns
  alias ToileWeb.BlockTexts
  alias ToileWeb.MeasurementTexts

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope} wide>
      <.header>
        {@project.name}
        <:subtitle>{BlockTexts.project_label(@project.block)}</:subtitle>
        <:actions>
          <div class="flex flex-wrap justify-end gap-2">
            <.button id="back-to-patterns" class="btn min-h-11" navigate={~p"/patterns"}>
              <.icon name="hero-arrow-left" /> {gettext("Back")}
            </.button>
            <.button
              id="rename-pattern"
              class="btn btn-primary min-h-11"
              navigate={~p"/patterns/#{@project}/edit"}
            >
              <.icon name="hero-pencil-square" /> {gettext("Rename")}
            </.button>
          </div>
        </:actions>
      </.header>

      <.form for={%{}} id="profile-form" phx-change="select_profile" class="max-w-md">
        <.input
          type="select"
          name="measurement_profile_id"
          id="profile-select"
          label={gettext("Measurement profile")}
          value={@project.measurement_profile_id}
          options={@profile_options}
          prompt={if is_nil(@profile), do: gettext("Choose a measurement profile")}
          class="w-full select select-lg min-h-11"
        />
      </.form>

      <div :if={@state == :no_profile} id="no-profile" role="status">
        <p>{gettext("Choose a measurement profile to draw this pattern.")}</p>
      </div>

      <div :if={@state == :missing} id="missing-measurements" class="space-y-2" role="status">
        <h2 class="font-semibold">{gettext("Measurements missing for this pattern")}</h2>
        <ul class="list-disc pl-6">
          <li :for={key <- @missing} id={"missing-measurement-#{key}"}>
            {MeasurementTexts.label(key)}
          </li>
        </ul>
        <.button
          id="edit-profile-link"
          class="btn btn-primary min-h-11"
          navigate={~p"/measurements/#{@profile}/edit?return_to=show"}
        >
          <.icon name="hero-pencil-square" /> {gettext("Edit measurement profile")}
        </.button>
      </div>

      <div :if={@state == :ready} id="pattern" class="space-y-2">
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            id="fit-pattern"
            class="btn min-h-11"
            phx-click={JS.dispatch("toile:fit", to: "#pattern-canvas")}
          >
            <.icon name="hero-arrows-pointing-in" /> {gettext("Fit to screen")}
          </button>
          <button
            type="button"
            id="zoom-in-pattern"
            class="btn min-h-11 min-w-11"
            aria-label={gettext("Zoom in")}
            title={gettext("Zoom in")}
            phx-click={JS.dispatch("toile:zoom", to: "#pattern-canvas", detail: %{factor: 0.8})}
          >
            <.icon name="hero-magnifying-glass-plus" />
          </button>
          <button
            type="button"
            id="zoom-out-pattern"
            class="btn min-h-11 min-w-11"
            aria-label={gettext("Zoom out")}
            title={gettext("Zoom out")}
            phx-click={JS.dispatch("toile:zoom", to: "#pattern-canvas", detail: %{factor: 1.25})}
          >
            <.icon name="hero-magnifying-glass-minus" />
          </button>
        </div>
        <div id={"pattern-view-#{@profile.id}"}>
          <div
            id="pattern-canvas"
            phx-hook="PatternView"
            phx-update="ignore"
            data-key={@profile.id}
            data-definition={JSON.encode!(@project.definition)}
            data-input={JSON.encode!(@engine_input)}
            data-piece-labels={JSON.encode!(@piece_labels)}
            data-label={gettext("Drawing of the pattern %{name}", name: @project.name)}
            data-error-text={gettext("The pattern could not be computed with these measurements.")}
            class="h-[70vh] w-full touch-none select-none overflow-hidden rounded-box border border-base-300 bg-base-100"
          >
          </div>
        </div>
      </div>
    </Layouts.app>
    """
  end

  @impl true
  def mount(%{"id" => id}, _session, socket) do
    scope = socket.assigns.current_scope
    project = Patterns.get_pattern_project!(scope, id)

    profile_options =
      scope
      |> Measurements.list_measurement_profiles()
      |> Enum.map(&{&1.name, &1.id})

    {:ok,
     socket
     |> assign(:profile_options, profile_options)
     |> assign_project(project)}
  end

  @impl true
  def handle_event("select_profile", %{"measurement_profile_id" => ""}, socket) do
    {:noreply, socket}
  end

  def handle_event("select_profile", %{"measurement_profile_id" => id}, socket)
      when is_binary(id) do
    scope = socket.assigns.current_scope
    project = socket.assigns.project

    case Patterns.update_pattern_project(scope, project, %{"measurement_profile_id" => id}) do
      {:ok, _project} ->
        {:noreply, assign_project(socket, Patterns.get_pattern_project!(scope, project.id))}

      {:error, %Ecto.Changeset{}} ->
        # Reload so the select shows the stored profile again, not the rejected choice.
        {:noreply,
         socket
         |> put_flash(:error, gettext("Could not change the measurement profile"))
         |> push_navigate(to: ~p"/patterns/#{project}")}
    end
  end

  defp assign_project(socket, project) do
    profile = project.measurement_profile

    socket
    |> assign(:page_title, project.name)
    |> assign(:project, project)
    |> assign(:profile, profile)
    |> assign_state(project, profile)
  end

  defp assign_state(socket, _project, nil), do: assign(socket, :state, :no_profile)

  defp assign_state(socket, project, profile) do
    case Patterns.missing_measurements(project, profile) do
      [] ->
        socket
        |> assign(:state, :ready)
        |> assign(:engine_input, Patterns.engine_input(project, profile))
        |> assign(:piece_labels, piece_labels(project.definition))

      missing ->
        socket
        |> assign(:state, :missing)
        |> assign(:missing, missing)
    end
  end

  # The definition is untrusted data: only well-formed piece names get a label; the engine
  # reports anything else.
  defp piece_labels(%{"pieces" => pieces}) when is_list(pieces) do
    for %{"name" => name} when is_binary(name) <- pieces,
        into: %{},
        do: {name, BlockTexts.piece_label(name)}
  end

  defp piece_labels(_definition), do: %{}
end
