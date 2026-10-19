defmodule Toile.Patterns.PatternProject do
  @moduledoc """
  A user's pattern: a copy of a block's pattern definition, parameter overrides, the blocks added
  to it and the measurement profile it is drafted for
  (`docs/adr/0006-pattern-projects-and-blocks.md`, `docs/adr/0007-project-parts-and-imports.md`).

  Owned by one user (`docs/adr/0001-per-user-scope.md`). `definition` is copied from
  `Toile.Patterns.Blocks` when the project is created and is never re-read from the block file.
  `parameters` holds overrides of the definition's parameter defaults (`%{}` at creation).
  Together they are the project's main part, named by `block`. `parts` holds the blocks added
  later (`Toile.Patterns.PatternPart`, such as a sleeve on a bodice), each with its own copy of
  the definition; it starts empty. The profile is optional in storage: deleting it sets
  `measurement_profile_id` to `nil`.

  Elixir never interprets the geometry in `definition`; the engine evaluates it in the browser.
  """

  use Ecto.Schema
  use Gettext, backend: ToileWeb.Gettext
  import Ecto.Changeset

  alias Toile.Measurements.MeasurementProfile
  alias Toile.Patterns.Blocks
  alias Toile.Patterns.DefinitionSize
  alias Toile.Patterns.PatternPart

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "pattern_projects" do
    field :name, :string
    field :block, :string
    field :definition, :map
    field :parameters, :map, default: %{}
    embeds_many :parts, PatternPart, on_replace: :delete
    belongs_to :measurement_profile, MeasurementProfile
    field :user_id, :binary_id

    timestamps(type: :utc_datetime)
  end

  @doc """
  Changeset for creating a project owned by `user_scope`.

  Casts only `name`, `block` and `measurement_profile_id`, all required. `block` must be a base
  block (`Toile.Patterns.Blocks.base_keys/0`): a block with imports, such as the sleeve, can only
  be added to a project. The definition is copied from the block, never cast; `parameters` starts empty and `user_id` comes from the scope. That
  the profile belongs to the same user is checked by `Toile.Patterns`, which needs the database.
  """
  def create_changeset(pattern_project, attrs, user_scope) do
    pattern_project
    |> cast(attrs, [:name, :block, :measurement_profile_id])
    |> validate_required([:name, :block, :measurement_profile_id])
    |> validate_length(:name, max: 100)
    |> validate_inclusion(:block, Blocks.base_keys())
    |> put_block_definition()
    |> validate_definition_size()
    |> foreign_key_constraint(:measurement_profile_id)
    |> put_change(:user_id, user_scope.user.id)
  end

  @doc """
  Changeset for updating a project owned by `user_scope`: renaming it or choosing another profile.

  `block`, `definition`, `parameters`, `parts` and `user_id` are never cast. `user_scope` is unused for now
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
  Changeset that appends the block `block_key` to the project's parts, as a copy of its
  definition with no parameter overrides; the part is named by the key.

  Checks nothing about whether the block may be added: `Toile.Patterns.add_part/3` does that
  (with the project row locked) before calling this. `block_key` must name a block
  (`Toile.Patterns.Blocks.definition/1` raises otherwise). `user_scope` is unused for now and
  keeps the signature in line with the other changesets and ADR 0001.
  """
  def add_part_changeset(pattern_project, block_key, _user_scope) when is_binary(block_key) do
    part = %PatternPart{
      name: block_key,
      block: block_key,
      definition: Blocks.definition(block_key),
      parameters: %{}
    }

    pattern_project
    |> change()
    |> put_embed(:parts, pattern_project.parts ++ [part])
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
