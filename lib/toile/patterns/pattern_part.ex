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

  Parts are only ever built by `Toile.Patterns.PatternProject.add_part_changeset/3`, never cast
  from user input.
  """

  use Ecto.Schema

  @primary_key false
  embedded_schema do
    field :name, :string
    field :block, :string
    field :definition, :map
    field :parameters, :map, default: %{}
  end
end
