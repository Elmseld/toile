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

  test "definition/1 returns the decoded sleeve file" do
    definition = Blocks.definition("straight_sleeve")

    assert definition["name"] == "Straight sleeve"
    assert definition["measurements"] == ~w(upper_arm arm_length wrist)

    assert definition ==
             @blocks_dir |> Path.join("straight_sleeve.json") |> File.read!() |> JSON.decode!()
  end

  test "base_keys/0 lists the blocks without imports, sorted" do
    assert Blocks.base_keys() == ["bodice", "straight_skirt"]

    for key <- Blocks.keys() do
      assert key in Blocks.base_keys() == (Blocks.imports(key) == %{})
    end
  end

  test "imports/1 returns a block's imports, %{} without any" do
    assert Blocks.imports("straight_sleeve") == %{
             "back_armhole_length" => "bodice.back_armhole_length",
             "front_armhole_length" => "bodice.front_armhole_length",
             "back_armhole_to_notch" => "bodice.back_armhole_to_notch",
             "front_armhole_to_notch" => "bodice.front_armhole_to_notch"
           }

    assert Blocks.imports("bodice") == %{}
    assert Blocks.imports("straight_skirt") == %{}
    assert_raise ArgumentError, ~r/unknown block "nope"/, fn -> Blocks.imports("nope") end
  end

  test "every import names a formula of a base block" do
    for key <- Blocks.keys(), {_name, reference} <- Blocks.imports(key) do
      [part, value] = String.split(reference, ".")
      assert part in Blocks.base_keys(), "#{key} imports from #{inspect(part)}"
      assert Map.has_key?(Blocks.definition(part)["formulas"], value)
    end
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
