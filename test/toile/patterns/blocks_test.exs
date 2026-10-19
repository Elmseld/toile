defmodule Toile.Patterns.BlocksTest do
  use ExUnit.Case, async: true

  alias Toile.Measurements
  alias Toile.Patterns.Blocks

  doctest Blocks

  @blocks_dir Path.expand("../../../engine/blocks", __DIR__)

  test "keys/0 equals the sorted file names in engine/blocks" do
    file_keys =
      @blocks_dir
      |> Path.join("*.json")
      |> Path.wildcard()
      |> Enum.map(&Path.basename(&1, ".json"))
      |> Enum.sort()

    assert Blocks.keys() == file_keys
    assert "bodice" in Blocks.keys()
    assert "straight_skirt" in Blocks.keys()
  end

  test "definition/1 returns the decoded block file" do
    definition = Blocks.definition("straight_skirt")

    assert definition["version"] == 1
    assert definition["name"] == "Straight skirt"
    assert definition["measurements"] == ~w(waist hip hip_height skirt_length)

    assert definition ==
             @blocks_dir |> Path.join("straight_skirt.json") |> File.read!() |> JSON.decode!()
  end

  test "definition/1 returns the decoded bodice file" do
    definition = Blocks.definition("bodice")

    assert definition["version"] == 1
    assert definition["name"] == "Bodice"

    assert definition["measurements"] ==
             ~w(bust waist neck shoulder_width back_width chest_width back_length armhole_depth
                bust_height bust_distance)

    assert definition ==
             @blocks_dir |> Path.join("bodice.json") |> File.read!() |> JSON.decode!()
  end

  test "every block declares only catalogue measurement keys" do
    catalogue = Enum.map(Measurements.keys(), &Atom.to_string/1)

    for key <- Blocks.keys(), measurement <- Blocks.definition(key)["measurements"] do
      assert measurement in catalogue, "#{key} declares #{inspect(measurement)}"
    end
  end

  test "definition/1 raises for an unknown key" do
    assert_raise ArgumentError, ~r/unknown block "nope"/, fn -> Blocks.definition("nope") end
  end

  test "exists?/1 is false for anything that is not a block key" do
    refute Blocks.exists?("nope")
    refute Blocks.exists?(nil)
    refute Blocks.exists?(:straight_skirt)
  end

  test "__mix_recompile__?/0 is false while the block files are unchanged" do
    refute Blocks.__mix_recompile__?()
  end
end
