defmodule ToileWeb.PatternLive.Form do
  @moduledoc """
  Creates (`:new`) or renames (`:edit`) a pattern project of the current user.

  `:new` asks for a name, a base block (`Toile.Patterns.Blocks.base_keys/0`, listed in a select
  with a prompt, nothing preselected; blocks with imports such as the sleeve are added on the
  project page instead) and one of the user's measurement profiles. Blocks are sorted by their
  translated label, case-insensitively in code point order (not Swedish collation: Ä before Å).
  A user without profiles sees `#no-profiles` with a link to create one instead of the form, since
  a project needs a profile.
  `:edit` only changes the name; the block and definition of a project never change here.

  Saving goes to the project page. The inputs follow the measurement form's touch sizes:
  `input-lg`/`select-lg` and buttons with a 44 px minimum height (`min-h-11`).
  """
  use ToileWeb, :live_view

  alias Toile.Measurements
  alias Toile.Patterns
  alias Toile.Patterns.Blocks
  alias Toile.Patterns.PatternProject
  alias ToileWeb.BlockTexts

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope}>
      <.header>{@page_title}</.header>

      <div :if={@live_action == :new and @profile_options == []} id="no-profiles" class="space-y-4">
        <p>{gettext("A pattern is drafted from a measurement profile. Create one first.")}</p>
        <.button
          id="new-measurement-profile-link"
          class="btn btn-primary btn-lg min-h-11"
          navigate={~p"/measurements/new"}
        >
          <.icon name="hero-plus" /> {gettext("New measurement profile")}
        </.button>
      </div>

      <.form
        :if={@live_action == :edit or @profile_options != []}
        for={@form}
        id="pattern-form"
        phx-change="validate"
        phx-submit="save"
      >
        <.input
          field={@form[:name]}
          label={gettext("Name")}
          class="w-full input input-lg min-h-11"
          autocomplete="off"
          phx-debounce="300"
        />

        <%= if @live_action == :new do %>
          <.input
            field={@form[:block]}
            type="select"
            label={gettext("Block")}
            prompt={gettext("Choose a block")}
            options={@block_options}
            class="w-full select select-lg min-h-11"
          />
          <.input
            field={@form[:measurement_profile_id]}
            type="select"
            label={gettext("Measurement profile")}
            prompt={gettext("Choose a measurement profile")}
            options={@profile_options}
            class="w-full select select-lg min-h-11"
          />
        <% end %>

        <footer class="mt-6 flex flex-wrap gap-2">
          <.button
            id="save-pattern"
            class="btn btn-primary btn-lg min-h-11"
            phx-disable-with={gettext("Saving...")}
          >
            {gettext("Save")}
          </.button>
          <.button
            id="cancel-pattern"
            class="btn btn-ghost btn-lg min-h-11"
            navigate={cancel_path(@pattern_project)}
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
    {:ok, apply_action(socket, socket.assigns.live_action, params)}
  end

  defp apply_action(socket, :edit, %{"id" => id}) do
    project = Patterns.get_pattern_project!(socket.assigns.current_scope, id)

    socket
    |> assign(:page_title, gettext("Rename pattern"))
    |> assign(:profile_options, [])
    |> assign_project(project, %{})
  end

  defp apply_action(socket, :new, _params) do
    scope = socket.assigns.current_scope
    project = %PatternProject{user_id: scope.user.id}

    profile_options =
      scope
      |> Measurements.list_measurement_profiles()
      |> Enum.map(&{&1.name, &1.id})

    block_options =
      Blocks.base_keys()
      |> Enum.map(&{BlockTexts.label(&1), &1})
      |> Enum.sort_by(fn {label, _key} -> String.downcase(label) end)

    socket
    |> assign(:page_title, gettext("New pattern"))
    |> assign(:block_options, block_options)
    |> assign(:profile_options, profile_options)
    |> assign_project(project, %{})
  end

  defp assign_project(socket, project, attrs) do
    changeset = Patterns.change_pattern_project(socket.assigns.current_scope, project, attrs)

    socket
    |> assign(:pattern_project, project)
    |> assign(:form, to_form(changeset))
  end

  @impl true
  def handle_event("validate", %{"pattern_project" => params}, socket) do
    changeset =
      Patterns.change_pattern_project(
        socket.assigns.current_scope,
        socket.assigns.pattern_project,
        params
      )

    {:noreply, assign(socket, form: to_form(changeset, action: :validate))}
  end

  def handle_event("save", %{"pattern_project" => params}, socket) do
    save_project(socket, socket.assigns.live_action, params)
  end

  defp save_project(socket, :edit, params) do
    # Only the name is renamed here; a profile switch belongs to the project page.
    params = Map.take(params, ["name"])

    case Patterns.update_pattern_project(
           socket.assigns.current_scope,
           socket.assigns.pattern_project,
           params
         ) do
      {:ok, project} ->
        {:noreply,
         socket
         |> put_flash(:info, gettext("Pattern renamed"))
         |> push_navigate(to: ~p"/patterns/#{project}")}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end

  defp save_project(socket, :new, params) do
    case Patterns.create_pattern_project(socket.assigns.current_scope, params) do
      {:ok, project} ->
        {:noreply,
         socket
         |> put_flash(:info, gettext("Pattern created"))
         |> push_navigate(to: ~p"/patterns/#{project}")}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end

  defp cancel_path(%PatternProject{id: nil}), do: ~p"/patterns"
  defp cancel_path(%PatternProject{} = project), do: ~p"/patterns/#{project}"
end
