defmodule Toile.Patterns.PatternPart do
  @moduledoc """
  A block added to a pattern project after it was created, such as a sleeve on a bodice
  (`docs/adr/0007-project-parts-and-imports.md`).

  Embedded in `Toile.Patterns.PatternProject` (`parts`). `name` is the part name other parts
  import from and equals `block`, so a block can be added to a project once. `definition` is a
  copy of the block's pattern definition made when the part was added and never re-read from the
  block file (as for the project's own definition, ADR 0006); `parameters` holds overrides of
  its parameter defaults (`%{}` when added). Elixir never interprets the geometry: the engine
  evaluates all parts of a project together in the browser.

  Parts are built by `Toile.Patterns.PatternProject.add_part_changeset/3`. The editor changes
  only a part's `definition` and `parameters`, through `edit_changeset/2` (ADR 0008); `name` and
  `block` are never cast.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Toile.Patterns.PatternProject

  @primary_key false
  embedded_schema do
    field :name, :string
    field :block, :string
    field :definition, :map
    field :parameters, :map, default: %{}
  end

  @doc """
  Changeset for saving the editor's work on this part: casts `definition` and `parameters` and
  checks them against the part's stored definition with
  `Toile.Patterns.PatternProject.validate_edit/2`.
  """
  def edit_changeset(%__MODULE__{} = part, attrs) do
    part
    |> cast(attrs, [:definition, :parameters])
    |> PatternProject.validate_edit(part.definition)
  end
end
