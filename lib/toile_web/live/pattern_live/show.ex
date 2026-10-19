defmodule ToileWeb.PatternLive.Show do
  @moduledoc """
  One pattern project of the current user, drawn to scale and editable.

  The server never computes geometry: it hands the stored definition and the engine input
  (`Toile.Patterns.engine_input/2`) to the `PatternView` hook (`assets/js/hooks/pattern_view.js`)
  in data attributes, and the hook runs the engine in the browser and draws the pieces in SVG
  over a centimetre grid, with zoom and pan.

  Exactly one of three states is rendered:

    * `#no-profile`: the project has no measurement profile (it was deleted); the user picks one.
    * `#missing-measurements`: the profile lacks measurements the definition declares; they are
      listed with a link to edit the profile, and nothing is drawn. The link passes
      `return_to=pattern` and the project id, so saving or cancelling comes back to this page.
    * `#pattern`: the drawing and the editor (`docs/adr/0008-pattern-editor.md`).

  ## The editor

  The browser owns the edit state: the working definition, the parameter overrides, the
  selection and the undo/redo history. `#pattern-canvas` carries the stored definition
  (`data-definition`, encoded once per project load and read by the hook on mount only), the
  engine input with the stored parameter overrides (`data-input`) and the editor's UI texts
  (`data-texts`, `ToileWeb.EditorTexts`). `data-editor` names the `#pattern-editor` aside, which
  HEEx renders once (`phx-update="ignore"`) and the hook then owns: the undo/redo buttons and the
  save status, the point panel (`#point-select`, with `#point-details` filled by the hook) and
  one row per parameter of the definition (`#parameter-<name>`, in `ToileWeb.ParameterTexts`
  order). A row carries `data-unit` (the `ParameterUnit` name) and `data-default` (the
  definition's default, in stored units); the stored override comes from `data-input` alone.
  Its input and its `-hint` paragraph render empty; the hook fills them in the display unit with
  the engine's `units.ts`, so the conversion has one source.

  Every committed edit is saved by the hook with the `save_pattern` event,
  `%{"definition" => map, "parameters" => map}`, which `Toile.Patterns.update_pattern_edits/3`
  accepts only where the definition differs from the stored one in user offsets and point
  formulas. The reply is `%{ok: true}` or `%{ok: false}`. A save does not send the definition
  back to the hook. The whole event must fit one websocket frame: `data-max-save-bytes`
  (`Toile.Patterns.PatternProject.max_save_bytes/0`) is the most the definition and parameters
  may add up to, in bytes of encoded JSON, and `data-max-definition-bytes`
  (`Toile.Patterns.PatternProject.max_definition_bytes/0`) the most the definition alone may
  take; the server rejects a save over either. Saves from two tabs replace each other: the last
  one wins.

  Choosing another profile in `#profile-form` saves it on the project. Between profiles that have
  every measurement the pattern needs, the hook element stays (there is no wrapper keyed by the
  profile any more), so the edit history survives; its `updated()` callback redraws when
  `data-key` or `data-input` changes (LiveView still patches the attributes of a
  `phx-update="ignore"` element). A profile with missing measurements replaces the canvas with
  `#missing-measurements`, which removes the hook and its history; the hook sends a commit that is
  not stored yet once more as it goes. A rejected profile (not the user's own)
  reloads the page with an error, so the select shows the stored profile again. Another user's
  project id raises `Ecto.NoResultsError` (404) through the scoped context.
  """
  use ToileWeb, :live_view

  alias Toile.Measurements
  alias Toile.Patterns
  alias Toile.Patterns.PatternProject
  alias ToileWeb.BlockTexts
  alias ToileWeb.EditorTexts
  alias ToileWeb.MeasurementTexts
  alias ToileWeb.ParameterTexts

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
        <div class="flex flex-col gap-4 lg:flex-row">
          <div class="min-w-0 flex-1 space-y-2">
            <div
              id="pattern-canvas"
              phx-hook="PatternView"
              phx-update="ignore"
              data-key={@profile.id}
              data-definition={@definition_json}
              data-input={JSON.encode!(@engine_input)}
              data-piece-labels={JSON.encode!(@piece_labels)}
              data-texts={@editor_texts_json}
              data-editor="pattern-editor"
              data-max-save-bytes={PatternProject.max_save_bytes()}
              data-max-definition-bytes={PatternProject.max_definition_bytes()}
              data-error-text={gettext("The pattern could not be computed with these measurements.")}
              role="group"
              aria-label={gettext("Drawing of the pattern %{name}", name: @project.name)}
              tabindex="0"
              aria-describedby="pattern-help"
              class="h-[70vh] w-full touch-none select-none overflow-hidden rounded-box border border-base-300 bg-base-100 focus-visible:outline-2 focus-visible:outline-primary"
            >
            </div>
            <p id="pattern-help" class="text-sm text-base-content/70">
              {gettext(
                "Drag a point to move it; drag anywhere else to move the view. Scroll or pinch to zoom. Ctrl+Z undoes, Ctrl+Shift+Z redoes. With the keyboard: arrow keys move, + and - zoom, 0 fits to the screen."
              )}
            </p>
          </div>

          <aside
            id="pattern-editor"
            phx-update="ignore"
            class="space-y-4 lg:w-80"
            aria-label={gettext("Edit the pattern")}
          >
            <div id="editor-actions" class="flex flex-wrap items-center gap-2">
              <button type="button" id="undo-button" class="btn min-h-11" disabled>
                <.icon name="hero-arrow-uturn-left" /> {gettext("Undo")}
              </button>
              <button type="button" id="redo-button" class="btn min-h-11" disabled>
                <.icon name="hero-arrow-uturn-right" /> {gettext("Redo")}
              </button>
              <span
                id="save-status"
                role="status"
                aria-live="polite"
                class="text-sm text-base-content/70"
              ></span>
            </div>
            <p id="editor-alert" role="alert" class="text-sm text-error"></p>

            <section id="point-panel" class="space-y-2" aria-labelledby="point-panel-heading">
              <h2 id="point-panel-heading" class="font-semibold">{gettext("Point")}</h2>
              <.input
                type="select"
                name="point"
                id="point-select"
                value=""
                options={@point_names}
                prompt={gettext("Choose a point")}
                aria-labelledby="point-panel-heading"
                aria-describedby="point-panel-help"
                class="w-full select min-h-11"
              />
              <p id="point-panel-help" class="text-sm text-base-content/70">
                {gettext("Click or tap a point in the pattern to select it.")}
                {gettext("Formulas count in millimetres.")}
              </p>
              <div id="point-details" class="space-y-2"></div>
            </section>

            <section
              :if={@parameter_rows != []}
              id="parameter-panel"
              class="space-y-2"
              aria-labelledby="parameter-panel-heading"
            >
              <h2 id="parameter-panel-heading" class="font-semibold">{gettext("Adjustments")}</h2>
              <p class="text-sm text-base-content/70">{gettext("Leave empty for the default.")}</p>
              <div
                :for={row <- @parameter_rows}
                id={"parameter-#{row.name}"}
                data-parameter={row.name}
                data-unit={row.unit}
                data-default={row.default}
              >
                <.input
                  type="text"
                  name={"parameters[#{row.name}]"}
                  id={"parameter-#{row.name}-input"}
                  value=""
                  label={row.label}
                  inputmode="decimal"
                  autocomplete="off"
                  aria-describedby={"parameter-#{row.name}-hint parameter-#{row.name}-error"}
                  class="w-full input min-h-11"
                />
                <p id={"parameter-#{row.name}-hint"} class="-mt-1 text-sm text-base-content/70"></p>
                <p id={"parameter-#{row.name}-error"} class="text-sm text-error"></p>
              </div>
            </section>
          </aside>
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
     |> assign(:editor_texts_json, JSON.encode!(EditorTexts.texts()))
     |> assign_project(project)}
  end

  @impl true
  def handle_event(
        "save_pattern",
        %{"definition" => definition, "parameters" => parameters},
        socket
      )
      when is_map(definition) and is_map(parameters) do
    scope = socket.assigns.current_scope
    attrs = %{"definition" => definition, "parameters" => parameters}

    # Only the project is updated, not the encoded definition or the engine input, so the reply
    # does not patch the hook's data attributes.
    case Patterns.update_pattern_edits(scope, socket.assigns.project, attrs) do
      {:ok, project} -> {:reply, %{ok: true}, assign(socket, :project, project)}
      {:error, %Ecto.Changeset{}} -> {:reply, %{ok: false}, socket}
    end
  end

  def handle_event("save_pattern", _params, socket), do: {:reply, %{ok: false}, socket}

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

  defp assign_project(socket, project) do
    profile = project.measurement_profile

    socket
    |> assign(:page_title, project.name)
    |> assign(:project, project)
    |> assign(:profile, profile)
    |> assign(:definition_json, JSON.encode!(project.definition))
    |> assign(:parameter_rows, parameter_rows(project))
    |> assign(:point_names, point_names(project.definition))
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

  # One row per declared parameter with a number default, in display order. Like the piece
  # labels, anything malformed is left to the engine.
  defp parameter_rows(%{definition: %{"parameters" => defaults}})
       when is_map(defaults) do
    defaults
    |> Map.keys()
    |> Enum.filter(&(is_binary(&1) and is_number(defaults[&1])))
    |> ParameterTexts.sort()
    |> Enum.map(&parameter_row(&1, defaults[&1]))
  end

  defp parameter_rows(_project), do: []

  # The default stays in stored units (mm, degrees): the hook formats it with the engine's units.
  defp parameter_row(name, default) do
    unit = ParameterTexts.unit(name)

    %{
      name: name,
      label: parameter_label(ParameterTexts.label(name), ParameterTexts.unit_label(unit)),
      unit: unit,
      default: default
    }
  end

  defp parameter_label(label, ""), do: label
  defp parameter_label(label, unit), do: gettext("%{label} (%{unit})", label: label, unit: unit)

  defp point_names(%{"points" => points}) when is_list(points) do
    for %{"name" => name} when is_binary(name) <- points, do: name
  end

  defp point_names(_definition), do: []
end
