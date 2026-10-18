defmodule Toile.Patterns do
  @moduledoc """
  The Patterns context: pattern projects owned by the current user.

  Every function that reads or writes projects takes a `%Toile.Accounts.Scope{}` first and only
  touches that user's projects (`docs/adr/0001-per-user-scope.md`). A project starts as a copy of
  a block from `Toile.Patterns.Blocks` and is drafted for one of the user's measurement profiles
  (`docs/adr/0006-pattern-projects-and-blocks.md`). This context stores and checks definitions
  but never computes geometry: `engine_input/2` builds what the engine in the browser needs.
  """

  use Gettext, backend: ToileWeb.Gettext

  import Ecto.Query, warn: false
  alias Toile.Repo

  alias Toile.Accounts.Scope
  alias Toile.Measurements
  alias Toile.Measurements.MeasurementProfile
  alias Toile.Patterns.PatternProject

  @max_projects_per_user 100

  # Every field except the jsonb `definition` and `parameters`, which the list does not need.
  @list_fields PatternProject.__schema__(:fields) -- [:definition, :parameters]

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

  `definition` and `parameters` are not loaded, so listing does not read up to
  #{@max_projects_per_user} definitions: `definition` is `nil` and `parameters` is the schema
  default `%{}`, whatever is stored. Use `get_pattern_project!/2` for a whole project.

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
  Returns the measurements the project's definition declares that `profile` has no value for, as
  catalogue keys (atoms) in catalogue order.

  Only names are compared, no geometry. Declared names that are not catalogue keys are ignored
  here; the engine reports them. Takes a project and profile that were already fetched through
  scoped functions, so it needs no scope.

  ## Examples

      iex> missing_measurements(pattern_project, profile_without_hip)
      [:hip]

  """
  def missing_measurements(
        %PatternProject{definition: definition},
        %MeasurementProfile{} = profile
      ) do
    declared = declared_measurements(definition)
    missing = Measurements.missing_measurements(profile)

    Enum.filter(missing, &(Atom.to_string(&1) in declared))
  end

  defp declared_measurements(%{"measurements" => names}) when is_list(names),
    do: Enum.filter(names, &is_binary/1)

  defp declared_measurements(_definition), do: []

  @doc """
  Returns the input the pattern engine evaluates the project's definition with:
  `%{"measurements" => %{key => mm}, "parameters" => overrides}`.

  Measurements without a value are left out (`Toile.Measurements.measurement_values/1`). Takes a
  project and profile that were already fetched through scoped functions, so it needs no scope.

  ## Examples

      iex> engine_input(pattern_project, profile)
      %{"measurements" => %{"waist" => 680, ...}, "parameters" => %{}}

  """
  def engine_input(%PatternProject{parameters: parameters}, %MeasurementProfile{} = profile)
      when is_map(parameters) do
    %{
      "measurements" => Measurements.measurement_values(profile),
      "parameters" => parameters
    }
  end
end
