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

  `seam_allowances` (`Toile.Patterns.SeamAllowances`) holds the project's seam allowance default
  (10 mm at creation) and the user's values per edge, for every part, outside the definitions
  (`docs/adr/0011-markings-and-seam-allowance-storage.md`). The editor saves them through
  `seam_allowances_changeset/4`.

  The editor on the project page saves the main part through `edit_changeset/3` and an added
  part through `Toile.Patterns.PatternPart.edit_changeset/2`. Both run `validate_edit/2`, which
  accepts a new `definition` only where it differs from the stored one in user offsets and point
  formulas (`Toile.Patterns.DefinitionEdit`, `docs/adr/0008-pattern-editor.md`), and parameter
  overrides only for declared parameters.

  Elixir never interprets the geometry in `definition`; the engine evaluates it in the browser.
  """

  use Ecto.Schema
  use Gettext, backend: ToileWeb.Gettext
  import Ecto.Changeset

  alias Toile.Measurements.MeasurementProfile
  alias Toile.Patterns.Blocks
  alias Toile.Patterns.DefinitionEdit
  alias Toile.Patterns.DefinitionSize
  alias Toile.Patterns.PatternPart
  alias Toile.Patterns.SeamAllowances

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
    embeds_many :parts, PatternPart, on_replace: :delete

    embeds_one :seam_allowances, SeamAllowances,
      on_replace: :update,
      defaults_to_struct: true

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

  `block`, `definition`, `parameters`, `parts`, `seam_allowances` and `user_id` are never cast. `user_scope` is unused for now
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
  Changeset for saving the editor's work on the main part of a project owned by `user_scope`.

  Casts `definition` and `parameters` and checks them with `validate_edit/2` against the stored
  definition. `user_scope` is unused for now, as in `changeset/3`.
  """
  def edit_changeset(pattern_project, attrs, _user_scope) do
    pattern_project
    |> cast(attrs, [:definition, :parameters])
    |> validate_edit(pattern_project.definition)
  end

  @doc """
  Validates an editor save cast into `changeset`, a project or a part
  (`Toile.Patterns.PatternPart.edit_changeset/2`), against the `stored` definition.

  `definition` and `parameters` are both required. The definition may differ from `stored` only
  in user offsets and point formula fields (`Toile.Patterns.DefinitionEdit.validate/2`); any
  other change gets the error "contains changes that cannot be saved", with the JSON pointer of
  the first difference as the error's `:path` option (for logs, not for users). Every key of
  `parameters` must be a parameter the definition declares, with a number of at most
  #{@max_parameter} in absolute value as its value. The definition size cap applies as usual,
  and the definition and parameters together must fit `max_save_bytes/0` (a save is one
  websocket frame).
  """
  def validate_edit(changeset, stored) do
    changeset
    |> validate_required([:definition, :parameters])
    |> validate_change(:definition, fn :definition, definition ->
      case DefinitionEdit.validate(stored, definition) do
        :ok ->
          []

        {:error, path} ->
          # The path is for the log line of a rejected save (`Toile.Patterns.update_pattern_edits/4`).
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
  Changeset for saving the editor's seam allowances of a project owned by `user_scope`.

  `attrs` are the allowances themselves, `%{"default" => mm, "edges" => %{part => %{curve =>
  mm}}}`, checked by `Toile.Patterns.SeamAllowances.changeset/3` against `outline_curves`, the
  curve names of each part's piece outlines. Nothing else is cast. `user_scope` is unused for
  now, as in `changeset/3`.
  """
  def seam_allowances_changeset(pattern_project, attrs, outline_curves, _user_scope)
      when is_map(attrs) and is_map(outline_curves) do
    pattern_project
    |> cast(%{"seam_allowances" => attrs}, [])
    |> cast_embed(:seam_allowances,
      required: true,
      with: &SeamAllowances.changeset(&1, &2, outline_curves)
    )
  end

  @doc """
  Changeset that replaces the added part at `index` of the project's parts with `part` (the
  result of a valid `Toile.Patterns.PatternPart.edit_changeset/2`). The other parts are kept as
  they are. `user_scope` is unused for now, as in `changeset/3`.
  """
  def put_part_changeset(pattern_project, index, %PatternPart{} = part, _user_scope)
      when is_integer(index) do
    pattern_project
    |> change()
    |> put_embed(:parts, List.replace_at(pattern_project.parts, index, part))
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
