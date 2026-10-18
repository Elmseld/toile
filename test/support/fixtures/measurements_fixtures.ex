defmodule Toile.MeasurementsFixtures do
  @moduledoc """
  Test helpers for creating measurement profiles via the `Toile.Measurements` context.
  """

  alias Toile.Measurements.Catalog

  @doc """
  Creates a measurement profile for `scope`. Without attrs it has only a name, so every
  measurement is missing. Measurement values in `attrs` are millimetres.
  """
  def measurement_profile_fixture(scope, attrs \\ %{}) do
    attrs = Enum.into(attrs, %{name: "some name"})

    {:ok, measurement_profile} = Toile.Measurements.create_measurement_profile(scope, attrs)
    measurement_profile
  end

  @doc """
  Measurement attrs (millimetres) with a valid value for every catalogue key.
  """
  def complete_measurements do
    Map.new(Catalog.keys(), &{&1, 500})
  end
end
