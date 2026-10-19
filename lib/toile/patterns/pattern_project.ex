defmodule Toile.Patterns.PatternProject do
  @moduledoc """
  A user's pattern: a copy of a block's pattern definition, parameter overrides and the
  measurement profile it is drafted for (`docs/adr/0006-pattern-projects-and-blocks.md`).

  Owned by one user (`docs/adr/0001-per-user-scope.md`). `definition` is copied from
  `Toile.Patterns.Blocks` when the project is created and is never re-read from the block file.
  `parameters` holds overrides of the definition's parameter defaults (`%{}` at creation). The
  profile is optional in storage: deleting it sets `measurement_profile_id` to `nil`.

  The editor on the project page saves through `edit_changeset/3`, which accepts a new
  `definition` only where it differs from the stored one in user offsets and point formulas
  (`Toile.Patterns.DefinitionEdit`, `docs/adr/0008-pattern-editor.md`), and parameter overrides
  only for declared parameters.

  Elixir never interprets the geometry in `definition`; the engine evaluates it in the browser.
  """

  use Ecto.Schema
  use Gettext, backend: ToileWeb.Gettext
  import Ecto.Changeset

  alias Toile.Measurements.MeasurementProfile
  alias Toile.Patterns.Blocks
  alias Toile.Patterns.DefinitionEdit
  alias Toile.Patterns.DefinitionSize

  # The engine's MAX_PARAMETER (engine/src/editor/units.ts); test/toile/patterns/engine_limits_test.exs
  # keeps the two equal.
  @max_parameter 1_000_000

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
  Changeset for saving the editor's work on a project owned by `user_scope`.

  Casts `definition` and `parameters`, both required. The definition may differ from the stored
  one only in user offsets and point formula fields (`Toile.Patterns.DefinitionEdit.validate/2`);
  any other change gets the error "contains changes that cannot be saved", with the JSON pointer
  of the first difference as the error's `:path` option (for logs, not for users). Every key of
  `parameters` must be a parameter the definition declares, with a number of at most
  #{@max_parameter} in absolute value as its value. The definition size cap applies as usual,
  and the definition and parameters together must fit `max_save_bytes/0` (a save is one
  websocket frame).
  `user_scope` is unused for now, as in `changeset/3`.
  """
  def edit_changeset(pattern_project, attrs, _user_scope) do
    stored = pattern_project.definition

    pattern_project
    |> cast(attrs, [:definition, :parameters])
    |> validate_required([:definition, :parameters])
    |> validate_change(:definition, fn :definition, definition ->
      case DefinitionEdit.validate(stored, definition) do
        :ok ->
          []

        {:error, path} ->
          # The path is for the log line of a rejected save (`Toile.Patterns.update_pattern_edits/3`).
          [
            definition:
              {dgettext_noop("errors", "contains changes that cannot be saved"), path: path}
          ]
      end
    end)
    |> validate_change(:parameters, fn :parameters, parameters ->
      if valid_parameters?(parameters, stored),
        do: [],
        else: [parameters: dgettext_noop("errors", "is invalid")]
    end)
    |> validate_definition_size()
    |> validate_save_size()
  end

  # Only checked once the rest is valid, so it does not encode a rejected payload.
  defp validate_save_size(%Ecto.Changeset{valid?: false} = changeset), do: changeset

  defp validate_save_size(changeset) do
    definition = get_field(changeset, :definition)
    parameters = get_field(changeset, :parameters)

    if DefinitionSize.save_too_large?(definition, parameters),
      do: add_error(changeset, :definition, dgettext_noop("errors", "is too large")),
      else: changeset
  end

  # The declared parameters are the stored definition's: the edit cannot change them.
  defp valid_parameters?(parameters, %{"parameters" => declared}) when is_map(declared) do
    Enum.all?(parameters, fn {name, value} ->
      Map.has_key?(declared, name) and is_number(value) and abs(value) <= @max_parameter
    end)
  end

  defp valid_parameters?(parameters, _definition), do: parameters == %{}

  @doc """
  Returns the maximum size of a stored definition, in bytes of encoded JSON
  (`Toile.Patterns.DefinitionSize.max_bytes/0`).
  """
  defdelegate max_definition_bytes, to: DefinitionSize, as: :max_bytes

  @doc """
  Returns the maximum size of an editor save, definition and parameters together, in bytes of
  encoded JSON (`Toile.Patterns.DefinitionSize.max_save_bytes/0`).
  """
  defdelegate max_save_bytes, to: DefinitionSize

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
