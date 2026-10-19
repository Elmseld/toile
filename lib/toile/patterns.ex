defmodule Toile.Patterns do
  @moduledoc """
  The Patterns context: pattern projects owned by the current user.

  Every function that reads or writes projects takes a `%Toile.Accounts.Scope{}` first and only
  touches that user's projects (`docs/adr/0001-per-user-scope.md`). A project starts as a copy of
  a base block from `Toile.Patterns.Blocks` and is drafted for one of the user's measurement
  profiles (`docs/adr/0006-pattern-projects-and-blocks.md`). Blocks with imports, such as the
  sleeve, can then be added to it as parts (`addable_blocks/1`, `add_part/3`,
  `docs/adr/0007-project-parts-and-imports.md`). This context stores and checks definitions but
  never computes geometry: `engine_parts/1` and `engine_input/2` build what the engine in the
  browser needs.
  """

  use Gettext, backend: ToileWeb.Gettext

  import Ecto.Query, warn: false
  alias Toile.Repo

  alias Toile.Accounts.Scope
  alias Toile.Measurements
  alias Toile.Measurements.MeasurementProfile
  alias Toile.Patterns.Blocks
  alias Toile.Patterns.PatternProject

  @max_projects_per_user 100

  # Every field except the jsonb `definition`, `parameters` and `parts`, which the list does not
  # need.
  @list_fields PatternProject.__schema__(:fields) -- [:definition, :parameters, :parts]

  @doc """
  Subscribes to scoped notifications about any pattern_project changes.

  The broadcasted messages match the pattern:

    * {:created, %PatternProject{}}
    * {:updated, %PatternProject{}}
    * {:deleted, %PatternProject{}}

  """
  def subscribe_pattern_projects(%Scope{} = scope) do
    key = scope.user.id

    Phoenix.PubSub.subscribe(Toile.PubSub, "user:#{key}:pattern_projects")
  end

  defp broadcast_pattern_project(%Scope{} = scope, message) do
    key = scope.user.id

    Phoenix.PubSub.broadcast(Toile.PubSub, "user:#{key}:pattern_projects", message)
  end

  @doc """
  Returns the scope's pattern projects, ordered by name (then creation time), with the
  measurement profile preloaded (only its `id` and `name`).

  `definition`, `parameters` and `parts` are not loaded, so listing does not read up to
  #{@max_projects_per_user} definitions: `definition` is `nil`, and `parameters` and `parts` are
  the schema defaults `%{}` and `[]`, whatever is stored. Use `get_pattern_project!/2` for a whole project.

  ## Examples

      iex> list_pattern_projects(scope)
      [%PatternProject{definition: nil}, ...]

  """
  def list_pattern_projects(%Scope{} = scope) do
    profiles =
      from p in MeasurementProfile,
        where: p.user_id == ^scope.user.id,
        select: struct(p, [:id, :name])

    Repo.all(
      from p in PatternProject,
        where: p.user_id == ^scope.user.id,
        order_by: [asc: p.name, asc: p.inserted_at],
        select: struct(p, ^@list_fields),
        preload: [measurement_profile: ^profiles]
    )
  end

  @doc """
  Gets a single pattern_project with its measurement profile preloaded.

  Raises `Ecto.NoResultsError` if the project does not exist or belongs to another user.

  ## Examples

      iex> get_pattern_project!(scope, id)
      %PatternProject{}

      iex> get_pattern_project!(scope, other_users_id)
      ** (Ecto.NoResultsError)

  """
  def get_pattern_project!(%Scope{} = scope, id) do
    PatternProject
    |> Repo.get_by!(id: id, user_id: scope.user.id)
    |> preload_profile(scope)
  end

  @doc """
  Returns whether `id` is the id of one of the scope's pattern projects.

  Never raises: a malformed id (not a UUID, or not a string) returns `false`, as does another
  user's project. Meant for checking an id taken from request params before linking to it.

  ## Examples

      iex> pattern_project_exists?(scope, id)
      true

      iex> pattern_project_exists?(scope, "not-a-uuid")
      false

  """
  def pattern_project_exists?(%Scope{} = scope, id) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} ->
        Repo.exists?(
          from p in PatternProject, where: p.id == ^uuid and p.user_id == ^scope.user.id
        )

      :error ->
        false
    end
  end

  # The profile query is scoped too, so a project can never expose another user's profile.
  defp preload_profile(%PatternProject{} = pattern_project, %Scope{} = scope) do
    profiles = from p in MeasurementProfile, where: p.user_id == ^scope.user.id

    Repo.preload(pattern_project, [measurement_profile: profiles], force: true)
  end

  @doc """
  Creates a pattern_project from a block.

  `attrs` needs `name`, `block` (a key of `Toile.Patterns.Blocks`) and `measurement_profile_id`,
  which must be one of the scope's profiles. The block's definition is copied into the project.

  A user can have at most #{@max_projects_per_user} projects (`max_pattern_projects/0`). Above
  that the changeset gets an error on `:name`. Creates for the same user are serialized by a
  transaction-scoped advisory lock while counting, so concurrent creates cannot overshoot it.

  ## Examples

      iex> create_pattern_project(scope, %{name: "Skirt", block: "straight_skirt", measurement_profile_id: id})
      {:ok, %PatternProject{}}

      iex> create_pattern_project(scope, %{name: nil})
      {:error, %Ecto.Changeset{}}

  """
  def create_pattern_project(%Scope{} = scope, attrs) do
    changeset =
      %PatternProject{}
      |> PatternProject.create_changeset(attrs, scope)
      |> validate_profile_owner(scope)

    with {:ok, pattern_project = %PatternProject{}} <-
           Repo.transact(fn -> insert_within_limit(scope, changeset) end) do
      pattern_project = preload_profile(pattern_project, scope)
      broadcast_pattern_project(scope, {:created, pattern_project})
      {:ok, pattern_project}
    end
  end

  defp insert_within_limit(%Scope{user: %{id: user_id}}, changeset) do
    # Same pattern as Toile.Measurements: an advisory lock keeps this context out of Accounts'
    # schema; a `hashtext` collision between two users only serializes their creates.
    Repo.query!("SELECT pg_advisory_xact_lock(hashtext($1))", ["pattern_projects:#{user_id}"])

    count = Repo.aggregate(from(p in PatternProject, where: p.user_id == ^user_id), :count)

    if count >= @max_projects_per_user do
      # `limit`, not `count`, so `translate_error/1` does not look the message up as a plural.
      changeset =
        Ecto.Changeset.add_error(
          changeset,
          :name,
          dgettext_noop("errors", "you can have at most %{limit} patterns"),
          limit: @max_projects_per_user
        )

      {:error, %{changeset | action: :insert}}
    else
      Repo.insert(changeset)
    end
  end

  @doc """
  Returns the maximum number of pattern projects a user can have.
  """
  def max_pattern_projects, do: @max_projects_per_user

  @doc """
  Updates a pattern_project: its `name` and `measurement_profile_id` only.

  A new profile must be one of the scope's profiles. The returned project has the new profile
  preloaded.

  ## Examples

      iex> update_pattern_project(scope, pattern_project, %{name: "New name"})
      {:ok, %PatternProject{}}

      iex> update_pattern_project(scope, pattern_project, %{name: nil})
      {:error, %Ecto.Changeset{}}

  """
  def update_pattern_project(%Scope{} = scope, %PatternProject{} = pattern_project, attrs) do
    true = pattern_project.user_id == scope.user.id

    changeset =
      pattern_project
      |> PatternProject.changeset(attrs, scope)
      |> validate_profile_owner(scope)

    with {:ok, pattern_project = %PatternProject{}} <- Repo.update(changeset) do
      pattern_project = maybe_reload_profile(pattern_project, changeset, scope)
      broadcast_pattern_project(scope, {:updated, pattern_project})
      {:ok, pattern_project}
    end
  end

  # Changing the foreign key leaves the old profile in the association; reload it.
  defp maybe_reload_profile(pattern_project, changeset, scope) do
    if Ecto.Changeset.changed?(changeset, :measurement_profile_id) do
      preload_profile(pattern_project, scope)
    else
      pattern_project
    end
  end

  @doc """
  Deletes a pattern_project.

  ## Examples

      iex> delete_pattern_project(scope, pattern_project)
      {:ok, %PatternProject{}}

  """
  def delete_pattern_project(%Scope{} = scope, %PatternProject{} = pattern_project) do
    true = pattern_project.user_id == scope.user.id

    with {:ok, pattern_project = %PatternProject{}} <- Repo.delete(pattern_project) do
      broadcast_pattern_project(scope, {:deleted, pattern_project})
      {:ok, pattern_project}
    end
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for tracking pattern_project changes.

  A project without an id gets the create changeset (name, block, profile); a stored one the
  update changeset (name, profile). Profile ownership is only checked when saving.

  ## Examples

      iex> change_pattern_project(scope, pattern_project)
      %Ecto.Changeset{data: %PatternProject{}}

  """
  def change_pattern_project(%Scope{} = scope, %PatternProject{} = pattern_project, attrs \\ %{}) do
    case pattern_project do
      %PatternProject{id: nil} ->
        PatternProject.create_changeset(pattern_project, attrs, scope)

      %PatternProject{} ->
        true = pattern_project.user_id == scope.user.id
        PatternProject.changeset(pattern_project, attrs, scope)
    end
  end

  # A foreign key only proves that the profile exists; this proves it is the scope's own.
  defp validate_profile_owner(changeset, %Scope{} = scope) do
    Ecto.Changeset.validate_change(changeset, :measurement_profile_id, fn
      :measurement_profile_id, nil ->
        []

      :measurement_profile_id, id ->
        if profile_owned?(id, scope),
          do: [],
          else: [measurement_profile_id: dgettext_noop("errors", "is invalid")]
    end)
  end

  # `:binary_id` casts any string, so a malformed id is rejected here before it reaches a query.
  defp profile_owned?(id, %Scope{} = scope) do
    case Ecto.UUID.cast(id) do
      {:ok, uuid} ->
        Repo.exists?(
          from p in MeasurementProfile, where: p.id == ^uuid and p.user_id == ^scope.user.id
        )

      :error ->
        false
    end
  end

  @doc """
  Returns the measurements the project's definitions declare that `profile` has no value for, as
  catalogue keys (atoms) in catalogue order: those of the main definition and of every added
  part, so adding a sleeve adds its arm measurements.

  Only names are compared, no geometry. Declared names that are not catalogue keys are ignored
  here; the engine reports them. Takes a project and profile that were already fetched through
  scoped functions, so it needs no scope.

  ## Examples

      iex> missing_measurements(pattern_project, profile_without_hip)
      [:hip]

  """
  def missing_measurements(
        %PatternProject{definition: definition, parts: parts},
        %MeasurementProfile{} = profile
      ) do
    declared =
      [definition | Enum.map(parts, & &1.definition)]
      |> Enum.flat_map(&declared_measurements/1)
      |> MapSet.new()

    missing = Measurements.missing_measurements(profile)

    Enum.filter(missing, &(Atom.to_string(&1) in declared))
  end

  defp declared_measurements(%{"measurements" => names}) when is_list(names),
    do: Enum.filter(names, &is_binary/1)

  defp declared_measurements(_definition), do: []

  @doc """
  Returns the parts of the project as the engine's `compileProject` takes them: the main part
  (named by the project's `block`, with its `definition`) first, then every added part in the
  order it was added, each `%{"name" => name, "definition" => definition}`.

  Takes a project that was already fetched through a scoped function, so it needs no scope.

  ## Examples

      iex> engine_parts(bodice_project_with_sleeve)
      [%{"name" => "bodice", "definition" => %{...}},
       %{"name" => "straight_sleeve", "definition" => %{...}}]

  """
  def engine_parts(%PatternProject{block: block, definition: definition, parts: parts}) do
    [
      %{"name" => block, "definition" => definition}
      | Enum.map(parts, &%{"name" => &1.name, "definition" => &1.definition})
    ]
  end

  @doc """
  Returns the input the pattern engine evaluates the project's parts with (`compileProject`):
  `%{"measurements" => %{key => mm}, "parameters" => %{part name => overrides}}`, with the main
  part's overrides under its `block` and each added part's under its name.

  Measurements without a value are left out (`Toile.Measurements.measurement_values/1`). Takes a
  project and profile that were already fetched through scoped functions, so it needs no scope.

  ## Examples

      iex> engine_input(pattern_project, profile)
      %{"measurements" => %{"waist" => 680, ...}, "parameters" => %{"straight_skirt" => %{}}}

  """
  def engine_input(
        %PatternProject{block: block, parameters: parameters, parts: parts},
        %MeasurementProfile{} = profile
      )
      when is_map(parameters) do
    %{
      "measurements" => Measurements.measurement_values(profile),
      "parameters" => Map.new([{block, parameters} | Enum.map(parts, &{&1.name, &1.parameters})])
    }
  end

  @doc """
  Returns the keys of the blocks that can be added to the project, sorted.

  A block can be added when it has imports (base blocks only start projects), is not a part of
  the project yet (the main part is named by the project's `block`), and every import
  `"<part>.<value>"` names a part of the project whose stored definition declares `value` as a
  formula, parameter or measurement. Only names are compared, no geometry: a bodice project
  created before the bodice exposed the values the sleeve imports keeps its own copy (ADR 0006)
  and is not offered the sleeve. Takes a project that was already fetched through a scoped
  function, so it needs no scope.

  ## Examples

      iex> addable_blocks(bodice_project)
      ["straight_sleeve"]

      iex> addable_blocks(skirt_project)
      []

  """
  def addable_blocks(%PatternProject{} = pattern_project) do
    definitions = Map.new(engine_parts(pattern_project), &{&1["name"], &1["definition"]})

    Enum.filter(Blocks.keys(), fn key ->
      imports = Blocks.imports(key)

      imports != %{} and not Map.has_key?(definitions, key) and
        Enum.all?(imports, fn {_name, reference} -> import_available?(reference, definitions) end)
    end)
  end

  defp import_available?(reference, definitions) do
    [part, value] = String.split(reference, ".", parts: 2)

    case Map.fetch(definitions, part) do
      {:ok, definition} -> declares?(definition, value)
      :error -> false
    end
  end

  defp declares?(%{} = definition, value) do
    has_key?(definition["formulas"], value) or has_key?(definition["parameters"], value) or
      value in declared_measurements(definition)
  end

  defp declares?(_definition, _value), do: false

  defp has_key?(%{} = map, key), do: Map.has_key?(map, key)
  defp has_key?(_other, _key), do: false

  @doc """
  Adds the block `block_key` to the project as a part: a copy of its definition with no
  parameter overrides (ADR 0007).

  `block_key` usually comes from the client, so it is only accepted when it is one of
  `addable_blocks/1` for the project as stored now: the project row is locked and re-read in the
  transaction, so a block that is not addable, an unknown key, or a second add of the same block
  (a double click, another tab) gives `{:error, :not_addable}`. The key is never turned into an
  atom. Returns the updated project with its profile preloaded and broadcasts `{:updated,
  project}`.

  Raises if the project belongs to another user, or (`Ecto.NoResultsError`) if it no longer
  exists.

  ## Examples

      iex> add_part(scope, bodice_project, "straight_sleeve")
      {:ok, %PatternProject{parts: [%PatternPart{name: "straight_sleeve"}]}}

      iex> add_part(scope, bodice_project_with_sleeve, "straight_sleeve")
      {:error, :not_addable}

  """
  def add_part(%Scope{} = scope, %PatternProject{} = pattern_project, block_key) do
    true = pattern_project.user_id == scope.user.id

    result =
      Repo.transact(fn ->
        locked =
          Repo.one!(
            from p in PatternProject,
              where: p.id == ^pattern_project.id and p.user_id == ^scope.user.id,
              lock: "FOR UPDATE"
          )

        if is_binary(block_key) and block_key in addable_blocks(locked) do
          locked
          |> PatternProject.add_part_changeset(block_key, scope)
          |> Repo.update()
        else
          {:error, :not_addable}
        end
      end)

    with {:ok, pattern_project = %PatternProject{}} <- result do
      pattern_project = preload_profile(pattern_project, scope)
      broadcast_pattern_project(scope, {:updated, pattern_project})
      {:ok, pattern_project}
    end
  end
end
