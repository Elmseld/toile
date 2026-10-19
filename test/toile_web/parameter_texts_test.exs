defmodule ToileWeb.ParameterTextsTest do
  use ExUnit.Case, async: true

  alias Toile.Patterns.Blocks
  alias ToileWeb.ParameterTexts

  doctest ParameterTexts

  defp block_parameters do
    for key <- Blocks.keys(),
        name <- Map.keys(Blocks.definition(key)["parameters"]),
        uniq: true,
        do: name
  end

  test "every parameter of every block has a label of its own and a unit" do
    for name <- block_parameters() do
      assert ParameterTexts.label(name) != name, "parameter #{name} has no label"
      assert ParameterTexts.unit(name) in [:length, :angle, :angle_per_length]
    end
  end

  test "labels are distinct" do
    labels = Enum.map(block_parameters(), &ParameterTexts.label/1)
    assert Enum.uniq(labels) == labels
  end

  test "every block parameter has a place in the display order" do
    sorted = ParameterTexts.sort(block_parameters() ++ ["unknown"])
    assert List.last(sorted) == "unknown"
  end

  test "unknown names fall back to the name and a plain number" do
    assert ParameterTexts.label("pocket_depth") == "pocket_depth"
    assert ParameterTexts.unit("pocket_depth") == :number
  end

  test "units of the bodice's dart constants" do
    assert ParameterTexts.unit("bust_dart_rate") == :angle_per_length
    assert ParameterTexts.unit("max_bust_dart_angle") == :angle
    assert ParameterTexts.unit("bust_dart_offset") == :length
  end

  test "sort/1 puts ease first, then lengths, then dart constants, then unknown names" do
    assert ParameterTexts.sort(
             ~w(max_bust_dart_angle zz side_rise ease_hip back_dart_length aa ease_bust)
           ) ==
             ~w(ease_bust ease_hip side_rise back_dart_length max_bust_dart_angle aa zz)
  end

  test "unit_label/1 has a text for every unit" do
    assert ParameterTexts.unit_label(:length) == "cm"
    assert ParameterTexts.unit_label(:angle) == "degrees"
    assert ParameterTexts.unit_label(:angle_per_length) == "degrees per cm"
    assert ParameterTexts.unit_label(:number) == ""
  end
end
