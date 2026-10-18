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
end
