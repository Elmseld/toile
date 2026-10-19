defmodule ToileWeb.PatternLive.Show do
  @moduledoc """
  One pattern project of the current user, drawn to scale.

  The server never computes geometry: it hands the project's parts (`Toile.Patterns.engine_parts/1`:
  the main part from the block the project was created from, then any added parts such as a
  sleeve) and the engine input (`Toile.Patterns.engine_input/2`, parameter overrides by part name)
  to the `PatternView` hook (`assets/js/hooks/pattern_view.js`) in data attributes. The hook
  evaluates all parts together in the browser (`compileProject`), so a part that imports values
  from another (the sleeve from the bodice armhole, ADR 0007) is recomputed with it on every
  draw, lays them out side by side and draws the pieces and their notches in SVG over a
  centimetre grid, with zoom and pan.

  Exactly one of three states is rendered:

    * `#no-profile`: the project has no measurement profile (it was deleted); the user picks one.
    * `#missing-measurements`: the profile lacks measurements that any part declares; they are
      listed with a link to edit the profile, and nothing is drawn. The link passes
      `return_to=pattern` and the project id, so saving or cancelling comes back to this page.
    * `#pattern`: the drawing. The hook computes the pattern once per input: when a profile
      switch or an added part changes `data-key`, `data-parts` or `data-input`, its `updated()`
      callback redraws (LiveView still patches the attributes of a `phx-update="ignore"`
      element). The wrapper keyed by the profile id is only an extra measure; LiveView may keep
      and move the hook element by its id rather than mount it again.

  Choosing another profile in `#profile-form` saves it on the project. A rejected profile (not
  the user's own) reloads the page with an error, so the select shows the stored profile again.

  `#add-parts` ("Add to the pattern") offers a button per block that can be added to the project
  (`Toile.Patterns.addable_blocks/1`), in every state. The block key sent by the button is only
  accepted by `Toile.Patterns.add_part/3` if it is still addable; any refusal (e.g. the part was
  added in another tab meanwhile) reloads the page with an error. After an add, the new part's
  measurements count toward the missing-measurement list like the main part's.

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

      <section
        :if={@addable != []}
        id="add-parts"
        aria-labelledby="add-parts-heading"
        class="space-y-2"
      >
        <h2 id="add-parts-heading" class="font-semibold">{gettext("Add to the pattern")}</h2>
        <div class="flex flex-wrap gap-2">
          <button
            :for={key <- @addable}
            type="button"
            id={"add-part-#{key}"}
            class="btn min-h-11"
            phx-click="add_part"
            phx-value-block={key}
            phx-disable-with={gettext("Saving...")}
          >
            <.icon name="hero-plus" /> {BlockTexts.label(key)}
          </button>
        </div>
      </section>

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
          navigate={~p"/measurements/#{@profile}/edit?return_to=pattern&pattern_id=#{@project.id}"}
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
            data-parts={JSON.encode!(@engine_parts)}
            data-input={JSON.encode!(@engine_input)}
            data-piece-labels={JSON.encode!(@piece_labels)}
            data-error-text={gettext("The pattern could not be computed with these measurements.")}
            role="group"
            aria-label={gettext("Drawing of the pattern %{name}", name: @project.name)}
            tabindex="0"
            aria-describedby="pattern-help"
            class="h-[70vh] w-full touch-none select-none overflow-hidden rounded-box border border-base-300 bg-base-100 focus-visible:outline-2 focus-visible:outline-primary"
          >
          </div>
        </div>
        <p id="pattern-help" class="text-sm text-base-content/70">
          {gettext(
            "Drag to move the pattern; scroll or pinch to zoom. With the keyboard: arrow keys move, + and - zoom, 0 fits to the screen."
          )}
        </p>
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
      {:ok, project} ->
        {:noreply, assign_project(socket, project)}

      {:error, %Ecto.Changeset{}} ->
        # Reload so the select shows the stored profile again, not the rejected choice.
        {:noreply,
         socket
         |> put_flash(:error, gettext("Could not change the measurement profile"))
         |> push_navigate(to: ~p"/patterns/#{project}")}
    end
  end

  def handle_event("add_part", %{"block" => key}, socket) when is_binary(key) do
    scope = socket.assigns.current_scope
    project = socket.assigns.project

    case Patterns.add_part(scope, project, key) do
      {:ok, project} ->
        {:noreply,
         socket
         |> put_flash(:info, gettext("%{block} added", block: BlockTexts.label(key)))
         |> assign_project(project)}

      {:error, _reason} ->
        add_part_failed(socket, project)
    end
  end

  def handle_event("add_part", _params, socket) do
    add_part_failed(socket, socket.assigns.project)
  end

  # Reload so the page shows the project as stored (e.g. with the part another tab added).
  defp add_part_failed(socket, project) do
    {:noreply,
     socket
     |> put_flash(:error, gettext("Could not add to the pattern"))
     |> push_navigate(to: ~p"/patterns/#{project}")}
  end

  defp assign_project(socket, project) do
    profile = project.measurement_profile

    socket
    |> assign(:page_title, project.name)
    |> assign(:project, project)
    |> assign(:profile, profile)
    |> assign(:addable, Patterns.addable_blocks(project))
    |> assign_state(project, profile)
  end

  defp assign_state(socket, _project, nil), do: assign(socket, :state, :no_profile)

  defp assign_state(socket, project, profile) do
    case Patterns.missing_measurements(project, profile) do
      [] ->
        parts = Patterns.engine_parts(project)

        socket
        |> assign(:state, :ready)
        |> assign(:engine_input, Patterns.engine_input(project, profile))
        |> assign(:engine_parts, parts)
        |> assign(:piece_labels, piece_labels(parts))

      missing ->
        socket
        |> assign(:state, :missing)
        |> assign(:missing, missing)
    end
  end

  # The labels of the pieces of every part, by piece name. Definitions are untrusted data: only
  # well-formed piece names get a label; the engine reports anything else.
  defp piece_labels(parts) do
    for %{"definition" => definition} <- parts,
        name <- piece_names(definition),
        into: %{},
        do: {name, BlockTexts.piece_label(name)}
  end

  defp piece_names(%{"pieces" => pieces}) when is_list(pieces) do
    for %{"name" => name} when is_binary(name) <- pieces, do: name
  end

  defp piece_names(_definition), do: []
end
