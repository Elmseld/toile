defmodule Toile.Patterns.PatternProject do
  @moduledoc """
  A user's pattern: a copy of a block's pattern definition, parameter overrides and the
  measurement profile it is drafted for (`docs/adr/0006-pattern-projects-and-blocks.md`).

  Owned by one user (`docs/adr/0001-per-user-scope.md`). `definition` is copied from
  `Toile.Patterns.Blocks` when the project is created and is never re-read from the block file.
  `parameters` holds overrides of the definition's parameter defaults (`%{}` at creation). The
  profile is optional in storage: deleting it sets `measurement_profile_id` to `nil`.

  Elixir never interprets the geometry in `definition`; the engine evaluates it in the browser.
  """

  use Ecto.Schema
  use Gettext, backend: ToileWeb.Gettext
  import Ecto.Changeset

  alias Toile.Measurements.MeasurementProfile
  alias Toile.Patterns.Blocks
  alias Toile.Patterns.DefinitionSize

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "pattern_projects" do
    field :name, :string
    field :block, :string
    field :definition, :map
    field :parameters, :map, default: %{}
    belongs_to :measurement_profile, MeasurementProfile
    field :user_id, :binary_id

    timestamps(type: :utc_datetime)
  end

  @doc """
  Changeset for creating a project owned by `user_scope`.

  Casts only `name`, `block` and `measurement_profile_id`, all required. The definition is copied
  from the block, never cast; `parameters` starts empty and `user_id` comes from the scope. That
  the profile belongs to the same user is checked by `Toile.Patterns`, which needs the database.
  """
  def create_changeset(pattern_project, attrs, user_scope) do
    pattern_project
    |> cast(attrs, [:name, :block, :measurement_profile_id])
    |> validate_required([:name, :block, :measurement_profile_id])
    |> validate_length(:name, max: 100)
    |> validate_inclusion(:block, Blocks.keys())
    |> put_block_definition()
    |> validate_definition_size()
    |> foreign_key_constraint(:measurement_profile_id)
    |> put_change(:user_id, user_scope.user.id)
  end

  @doc """
  Changeset for updating a project owned by `user_scope`: renaming it or choosing another profile.

  `block`, `definition`, `parameters` and `user_id` are never cast. `user_scope` is unused for now
  and keeps the signature in line with `create_changeset/3` and ADR 0001.
  """
  def changeset(pattern_project, attrs, _user_scope) do
    pattern_project
    |> cast(attrs, [:name, :measurement_profile_id])
    |> validate_required([:name])
    |> validate_length(:name, max: 100)
    |> validate_definition_size()
    |> foreign_key_constraint(:measurement_profile_id)
  end

  @doc """
  Returns the maximum size of a stored definition, in bytes of encoded JSON
  (`Toile.Patterns.DefinitionSize.max_bytes/0`).
  """
  defdelegate max_definition_bytes, to: DefinitionSize, as: :max_bytes

  defp put_block_definition(changeset) do
    block = get_change(changeset, :block)

    if Blocks.exists?(block) do
      put_change(changeset, :definition, Blocks.definition(block))
    else
      changeset
    end
  end

  @doc """
  Adds an error on `:definition` when a changed definition encodes to more than
  `max_definition_bytes/0` bytes of JSON.

  Only a change is measured, so renaming a project does not encode its definition. Both
  changesets run it; it matters once definitions are edited (ticket 0008). Blocks over the cap
  already fail to compile (`Toile.Patterns.Blocks.Loader`), so a create never hits it.
  """
  def validate_definition_size(changeset) do
    validate_change(changeset, :definition, fn :definition, definition ->
      if DefinitionSize.too_large?(definition) do
        [definition: dgettext_noop("errors", "is too large")]
      else
        []
      end
    end)
  end
end
