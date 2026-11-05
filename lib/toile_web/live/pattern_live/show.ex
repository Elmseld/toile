defmodule ToileWeb.PatternLive.Show do
  @moduledoc """
  One pattern project of the current user, drawn to scale and editable.

  The server never computes geometry: it hands the project's parts (`Toile.Patterns.engine_parts/1`:
  the main part from the block the project was created from, then any added parts such as a
  sleeve) and the engine input (`Toile.Patterns.engine_input/2`, parameter overrides by part name)
  to the `PatternView` hook (`assets/js/hooks/pattern_view.js`) in data attributes. The hook
  evaluates all parts together in the browser (`compileProject`), so a part that imports values
  from another (the sleeve from the bodice armhole, ADR 0007) is recomputed with it on every
  draw, lays them out side by side and draws the pieces in SVG over a centimetre grid, with zoom
  and pan: each piece's seam line (its outline, dashed) inside its cutting line (solid, from the
  project's seam allowances), its fold edges, its notches on both lines and a label with the
  piece's name and cutting instruction (`docs/adr/0011-markings-and-seam-allowance-storage.md`).

  Exactly one of three states is rendered:

    * `#no-profile`: the project has no measurement profile (it was deleted); the user picks one.
    * `#missing-measurements`: the profile lacks measurements that any part declares; they are
      listed with a link to edit the profile, and nothing is drawn. The link passes
      `return_to=pattern` and the project id, so saving or cancelling comes back to this page.
    * `#pattern`: the drawing and the editor (`docs/adr/0008-pattern-editor.md`).

  ## The editor

  The browser owns the edit state of every part: the working definitions, the parameter
  overrides, the selection and the undo/redo history. `#pattern-canvas` carries the stored parts
  (`data-parts`; the editor reads them on mount and only takes parts it does not have yet from a
  later value), the engine input with the stored parameter overrides by part name (`data-input`)
  and the editor's UI texts (`data-texts`, `ToileWeb.EditorTexts`). `data-editor` names the
  editor aside, which HEEx renders once (`phx-update="ignore"`) and the hook then owns: the
  undo/redo buttons and the save status, the point panel (`#point-select`, whose option values are
  `<part>.<point>`, grouped by part when there are several, with `#point-details` filled by the
  hook) and one row per parameter of each part (`#parameter-<part>-<name>`, in
  `ToileWeb.ParameterTexts` order, under the part's name when there are several parts). A row
  carries `data-part`, `data-parameter`, `data-unit` (the `ParameterUnit` name) and
  `data-default` (the definition's default, in stored units); the stored override comes from
  `data-input` alone. Its input and its `-hint` paragraph render empty; the hook fills them in
  the display unit with the engine's `units.ts`, so the conversion has one source. The aside's
  id names the parts (`pattern-editor-<part>-<part>`), so adding a part renders a new aside with
  the new part's rows and points; the hook moves the editor over to it and keeps its history.

  `data-piece-labels` holds each piece's label and `data-piece-cuts` its cutting instruction
  ("cut 2", "cut 1 on fold"; `ToileWeb.BlockTexts.cut_instruction/2`), both by part and then
  piece name; a piece without a `cut` (a project created before ticket 0015) has no instruction.
  `data-notes` names `#pattern-notes`, the list under the drawing where the hook says, as plain
  text, which pieces have no cutting line or one the engine had to approximate.

  The seam allowance panel (`#seam-allowance-panel`, in the aside) holds the project default
  (`#seam-allowance-default-input`, empty in HEEx, filled in cm by the hook), the edge select
  (`#edge-select`, option values `<part>.<curve>` for every curve of each part's piece outlines,
  grouped by piece, under "<part>: <piece>" when there are several parts) and `#edge-details`,
  which the hook fills for the selected edge. The stored allowances, `%{"default" => mm, "edges"
  => %{part => %{curve => mm}}}` (`Toile.Patterns.seam_allowances/1`), are in
  `data-seam-allowances`. That attribute is assigned only in `assign_state/3`, never derived
  from `@project` in the template, so a save reply does not patch it (ADR 0008); the editor owns
  the allowances after mount and ignores later values.

  Every committed edit is saved by the hook with the `save_pattern` event, one part per event:
  `%{"part" => name, "definition" => map, "parameters" => map}`, which
  `Toile.Patterns.update_pattern_edits/4` accepts only where the definition differs from the
  part's stored one in user offsets and point formulas. The reply is `%{ok: true}` or
  `%{ok: false}`. The seam allowances are saved as one unit with the `save_seam_allowances`
  event, `%{"default" => mm, "edges" => %{part => %{curve => mm}}}`, which
  `Toile.Patterns.update_seam_allowances/3` accepts only for parts and outline curves of the
  project as stored and numbers from 0 to 100 mm; the reply is the same. A save does not send the definitions back to the hook. The whole event must fit
  one websocket frame: `data-max-save-bytes` (`Toile.Patterns.PatternProject.max_save_bytes/0`)
  is the most a part's definition and parameters may add up to, in bytes of encoded JSON, and
  `data-max-definition-bytes` (`Toile.Patterns.PatternProject.max_definition_bytes/0`) the most
  the definition alone may take; the server rejects a save over either. Saves from two tabs
  replace each other: the last one wins.

  Choosing another profile in `#profile-form` saves it on the project and reads the project
  again, so parts added in another tab meanwhile are drawn and counted. Between profiles that
  have every measurement the pattern needs, the hook element stays (there is no wrapper keyed by
  the profile any more), so the edit history survives; its `updated()` callback redraws when
  `data-key`, `data-parts` or `data-input` changes (LiveView still patches the attributes of a
  `phx-update="ignore"` element). A profile with missing measurements replaces the canvas with
  `#missing-measurements`, which removes the hook and its history; the hook sends the commits
  that are not stored yet once more as it goes. A rejected profile (not the user's own) reloads
  the page with an error, so the select shows the stored profile again.

  `#add-parts` ("Add to the pattern") offers a button per block that can be added to the project
  (`Toile.Patterns.addable_blocks/1`), in every state. The block key sent by the button is only
  accepted by `Toile.Patterns.add_part/3` if it is still addable; any refusal (e.g. the part was
  added in another tab meanwhile) reloads the page with an error. After an add, the new part's
  measurements count toward the missing-measurement list like the main part's, and its points
  and parameters can be edited like the main part's.

  Another user's project id raises `Ecto.NoResultsError` (404) through the scoped context.
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
        <div class="flex flex-col gap-4 lg:flex-row">
          <div class="min-w-0 flex-1 space-y-2">
            <div
              id="pattern-canvas"
              phx-hook="PatternView"
              phx-update="ignore"
              data-key={@profile.id}
              data-parts={@parts_json}
              data-input={JSON.encode!(@engine_input)}
              data-piece-labels={JSON.encode!(@piece_labels)}
              data-piece-cuts={JSON.encode!(@piece_cuts)}
              data-seam-allowances={@seam_allowances_json}
              data-notes="pattern-notes"
              data-texts={@editor_texts_json}
              data-editor={@editor_id}
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
            <ul
              id="pattern-notes"
              phx-update="ignore"
              role="status"
              aria-live="polite"
              class="space-y-1 text-sm text-warning"
            >
            </ul>
          </div>

          <%!--
            Keyed by its id, so a new aside (a part was added) is rendered in full. Otherwise
            LiveView sends unchanged function components (the buttons, the old parts' inputs)
            as placeholders for elements of the old aside, which the client cannot fill in a new
            phx-update="ignore" element.
          --%>
          <aside
            :for={editor_id <- [@editor_id]}
            :key={editor_id}
            id={editor_id}
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
                options={@point_options}
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
              id="seam-allowance-panel"
              class="space-y-2"
              aria-labelledby="seam-allowance-panel-heading"
            >
              <h2 id="seam-allowance-panel-heading" class="font-semibold">
                {gettext("Seam allowance")}
              </h2>
              <div id="seam-allowance-default" data-seam-allowance-default>
                <.input
                  type="text"
                  name="seam_allowance_default"
                  id="seam-allowance-default-input"
                  value=""
                  label={gettext("Seam allowance for every edge (cm)")}
                  inputmode="decimal"
                  autocomplete="off"
                  aria-describedby="seam-allowance-default-hint seam-allowance-default-error"
                  class="w-full input min-h-11"
                />
                <p id="seam-allowance-default-hint" class="-mt-1 text-sm text-base-content/70"></p>
                <p id="seam-allowance-default-error" class="text-sm text-error"></p>
              </div>
              <.input
                type="select"
                name="edge"
                id="edge-select"
                value=""
                options={@edge_options}
                prompt={gettext("Choose an edge")}
                aria-labelledby="seam-allowance-panel-heading"
                aria-describedby="edge-select-help"
                class="w-full select min-h-11"
              />
              <p id="edge-select-help" class="text-sm text-base-content/70">
                {gettext("Click or tap an edge in the pattern to select it.")}
              </p>
              <div id="edge-details" class="space-y-2"></div>
            </section>

            <section
              :if={@parameter_groups != []}
              id="parameter-panel"
              class="space-y-2"
              aria-labelledby="parameter-panel-heading"
            >
              <h2 id="parameter-panel-heading" class="font-semibold">{gettext("Adjustments")}</h2>
              <p class="text-sm text-base-content/70">{gettext("Leave empty for the default.")}</p>
              <div
                :for={group <- @parameter_groups}
                id={"parameter-group-#{group.part}"}
                class="space-y-2"
                role={if length(@parameter_groups) > 1, do: "group"}
                aria-labelledby={
                  if length(@parameter_groups) > 1, do: "parameter-group-#{group.part}-heading"
                }
              >
                <h3
                  :if={length(@parameter_groups) > 1}
                  id={"parameter-group-#{group.part}-heading"}
                  class="pt-2 font-semibold"
                >
                  {group.label}
                </h3>
                <div
                  :for={row <- group.rows}
                  id={"parameter-#{group.part}-#{row.name}"}
                  data-part={group.part}
                  data-parameter={row.name}
                  data-unit={row.unit}
                  data-default={row.default}
                >
                  <.input
                    type="text"
                    name={"parameters[#{group.part}][#{row.name}]"}
                    id={"parameter-#{group.part}-#{row.name}-input"}
                    value=""
                    label={row.label}
                    inputmode="decimal"
                    autocomplete="off"
                    aria-describedby={"parameter-#{group.part}-#{row.name}-hint parameter-#{group.part}-#{row.name}-error"}
                    class="w-full input min-h-11"
                  />
                  <p
                    id={"parameter-#{group.part}-#{row.name}-hint"}
                    class="-mt-1 text-sm text-base-content/70"
                  >
                  </p>
                  <p id={"parameter-#{group.part}-#{row.name}-error"} class="text-sm text-error"></p>
                </div>
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
        %{"part" => part, "definition" => definition, "parameters" => parameters},
        socket
      )
      when is_binary(part) and is_map(definition) and is_map(parameters) do
    scope = socket.assigns.current_scope
    attrs = %{"definition" => definition, "parameters" => parameters}

    # Only the project is updated, not the encoded parts or the engine input, so the reply does
    # not patch the hook's data attributes.
    case Patterns.update_pattern_edits(scope, socket.assigns.project, part, attrs) do
      {:ok, project} -> {:reply, %{ok: true}, assign(socket, :project, project)}
      {:error, _reason} -> {:reply, %{ok: false}, socket}
    end
  end

  def handle_event("save_pattern", _params, socket), do: {:reply, %{ok: false}, socket}

  def handle_event("save_seam_allowances", %{"default" => default, "edges" => edges}, socket)
      when is_map(edges) do
    scope = socket.assigns.current_scope
    attrs = %{"default" => default, "edges" => edges}

    # As with save_pattern, only the project is assigned: `@seam_allowances_json` stays as
    # mounted, so the reply does not patch the hook's data attributes.
    case Patterns.update_seam_allowances(scope, socket.assigns.project, attrs) do
      {:ok, project} -> {:reply, %{ok: true}, assign(socket, :project, project)}
      {:error, _changeset} -> {:reply, %{ok: false}, socket}
    end
  end

  def handle_event("save_seam_allowances", _params, socket), do: {:reply, %{ok: false}, socket}

  def handle_event("select_profile", %{"measurement_profile_id" => ""}, socket) do
    {:noreply, socket}
  end

  def handle_event("select_profile", %{"measurement_profile_id" => id}, socket)
      when is_binary(id) do
    scope = socket.assigns.current_scope
    project = socket.assigns.project

    case Patterns.update_pattern_project(scope, project, %{"measurement_profile_id" => id}) do
      {:ok, updated} ->
        # The assigned project may be stale (e.g. a part was added in another tab); read it
        # again so the drawing and the missing measurements cover every stored part.
        {:noreply, assign_project(socket, Patterns.get_pattern_project!(scope, updated.id))}

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
        |> assign(:parts_json, JSON.encode!(parts))
        |> assign(:editor_id, "pattern-editor-" <> Enum.map_join(parts, "-", & &1["name"]))
        |> assign(:point_options, point_options(parts))
        |> assign(:parameter_groups, parameter_groups(parts))
        |> assign(:piece_labels, piece_labels(parts))
        |> assign(:piece_cuts, piece_cuts(parts))
        |> assign(:edge_options, edge_options(parts))
        |> assign(:seam_allowances_json, JSON.encode!(Patterns.seam_allowances(project)))

      missing ->
        socket
        |> assign(:state, :missing)
        |> assign(:missing, missing)
    end
  end

  # The labels of the pieces of every part, by part name and then piece name, so pieces of the
  # same name in different parts cannot overwrite each other's label. Definitions are untrusted
  # data: only well-formed piece names get a label; the engine reports anything else.
  defp piece_labels(parts) do
    for %{"name" => part, "definition" => definition} <- parts, into: %{} do
      {part, Map.new(piece_names(definition), &{&1, BlockTexts.piece_label(&1)})}
    end
  end

  defp piece_names(%{"pieces" => pieces}) when is_list(pieces) do
    for %{"name" => name} when is_binary(name) <- pieces, do: name
  end

  defp piece_names(_definition), do: []

  # The cutting instruction of each piece that has a valid `cut`, by part name and then piece
  # name; a part none of whose pieces has one (a project created before ticket 0015) is left out.
  # On the fold means that an outline entry has `"fold" => true`.
  defp piece_cuts(parts) do
    for %{"name" => part, "definition" => definition} <- parts,
        cuts = part_piece_cuts(definition),
        cuts != %{},
        into: %{} do
      {part, cuts}
    end
  end

  defp part_piece_cuts(%{"pieces" => pieces}) when is_list(pieces) do
    # The engine rejects a definition whose `cut` is out of range; this only needs a count.
    for %{"name" => name, "cut" => cut} = piece
        when is_binary(name) and is_integer(cut) and cut > 0 <- pieces,
        into: %{} do
      {name, BlockTexts.cut_instruction(cut, on_fold?(piece))}
    end
  end

  defp part_piece_cuts(_definition), do: %{}

  defp on_fold?(%{"outline" => outline}) when is_list(outline),
    do: Enum.any?(outline, &match?(%{"fold" => true}, &1))

  defp on_fold?(_piece), do: false

  # The edge select's options, valued `<part>.<curve>`, grouped by piece: under the piece's label
  # for one part, under "<part>: <piece>" for several. A curve is listed once per part, under the
  # first piece whose outline has it.
  defp edge_options([%{"name" => part, "definition" => definition}]) do
    for {piece, options} <- part_edge_options(part, definition) do
      {BlockTexts.piece_label(piece), options}
    end
  end

  defp edge_options(parts) do
    for %{"name" => part, "definition" => definition} <- parts,
        {piece, options} <- part_edge_options(part, definition) do
      label =
        gettext("%{part}: %{piece}",
          part: BlockTexts.project_label(part),
          piece: BlockTexts.piece_label(piece)
        )

      {label, options}
    end
  end

  defp part_edge_options(part, %{"pieces" => pieces}) when is_list(pieces) do
    {groups, _seen} =
      Enum.flat_map_reduce(pieces, MapSet.new(), fn
        %{"name" => piece, "outline" => outline}, seen
        when is_binary(piece) and is_list(outline) ->
          curves =
            for %{"curve" => curve} when is_binary(curve) <- outline, uniq: true, do: curve

          new = Enum.reject(curves, &MapSet.member?(seen, &1))
          options = Enum.map(new, &{&1, "#{part}.#{&1}"})
          group = if options == [], do: [], else: [{piece, options}]
          {group, Enum.into(new, seen)}

        _malformed, seen ->
          {[], seen}
      end)

    groups
  end

  defp part_edge_options(_part, _definition), do: []

  # The parts' parameter rows, one group per part that has any, in part order.
  defp parameter_groups(parts) do
    for %{"name" => part, "definition" => definition} <- parts,
        rows = parameter_rows(definition),
        rows != [] do
      %{part: part, label: BlockTexts.project_label(part), rows: rows}
    end
  end

  # One row per declared parameter with a number default, in display order. Like the piece
  # labels, anything malformed is left to the engine.
  defp parameter_rows(%{"parameters" => defaults}) when is_map(defaults) do
    defaults
    |> Map.keys()
    |> Enum.filter(&(is_binary(&1) and is_number(defaults[&1])))
    |> ParameterTexts.sort()
    |> Enum.map(&parameter_row(&1, defaults[&1]))
  end

  defp parameter_rows(_definition), do: []

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

  # The point select's options, valued `<part>.<point>`: flat for one part, grouped by part
  # label for several.
  defp point_options([%{"name" => part, "definition" => definition}]) do
    part_point_options(part, definition)
  end

  defp point_options(parts) do
    for %{"name" => part, "definition" => definition} <- parts,
        options = part_point_options(part, definition),
        options != [] do
      {BlockTexts.project_label(part), options}
    end
  end

  defp part_point_options(part, %{"points" => points}) when is_list(points) do
    for %{"name" => name} when is_binary(name) <- points, do: {name, "#{part}.#{name}"}
  end

  defp part_point_options(_part, _definition), do: []
end
