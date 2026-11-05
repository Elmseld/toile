defmodule Toile.PatternsFixtures do
  @moduledoc """
  Test helpers for creating pattern projects via the `Toile.Patterns` context.
  """

  import Toile.MeasurementsFixtures

  @doc """
  Creates a straight skirt pattern project for `scope`.

  Without a `measurement_profile_id` in `attrs` it first creates a profile for `scope` with a
  value for every catalogue key (`complete_measurements/0`).
  """
  def pattern_project_fixture(scope, attrs \\ %{}) do
    attrs = Map.new(attrs)

    attrs =
      Map.put_new_lazy(attrs, :measurement_profile_id, fn ->
        measurement_profile_fixture(scope, measurements: complete_measurements()).id
      end)

    attrs = Enum.into(attrs, %{name: "some name", block: "straight_skirt"})

    {:ok, pattern_project} = Toile.Patterns.create_pattern_project(scope, attrs)
    pattern_project
  end

  @doc """
  Adds the block `block` (default the straight sleeve) to `pattern_project` and returns the
  updated project. The block must be addable (`Toile.Patterns.addable_blocks/1`), so for the
  sleeve the project must be a bodice project: `pattern_project_fixture(scope, block: "bodice")`.
  """
  def pattern_part_fixture(scope, pattern_project, block \\ "straight_sleeve") do
    {:ok, pattern_project} = Toile.Patterns.add_part(scope, pattern_project, block)
    pattern_project
  end
end
