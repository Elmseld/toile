defmodule Toile.Measurements.CatalogTest do
  use ExUnit.Case, async: true

  alias Toile.Measurements.Catalog

  doctest Catalog

  @expected ~w(bust waist hip neck shoulder_width back_width chest_width back_length front_length
               bust_height bust_distance hip_height skirt_length arm_length upper_arm wrist height)a

  test "keys/0 lists the catalogue keys in display order" do
    assert Catalog.keys() == @expected
  end

  test "keys/0 matches engine/src/measurements.json" do
    file_keys =
      Path.expand("../../../engine/src/measurements.json", __DIR__)
      |> File.read!()
      |> JSON.decode!()

    assert Enum.map(Catalog.keys(), &Atom.to_string/1) == file_keys
  end
end
