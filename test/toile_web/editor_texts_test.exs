defmodule ToileWeb.EditorTextsTest do
  use ExUnit.Case, async: true

  alias Toile.Patterns.PointOps
  alias ToileWeb.EditorTexts

  setup do
    %{texts: EditorTexts.texts()}
  end

  test "has a description for every point op", %{texts: texts} do
    assert texts["ops"] |> Map.keys() |> Enum.sort() == PointOps.ops()

    for {op, text} <- texts["ops"], do: assert(text =~ ~r/\S/, "op #{op} has no text")
  end

  test "has a label for every field of every op", %{texts: texts} do
    fields = PointOps.ops() |> Enum.flat_map(&PointOps.fields/1) |> Enum.uniq() |> Enum.sort()

    assert texts["fields"] |> Map.keys() |> Enum.sort() == fields
  end

  test "keeps the placeholders for the hook to fill in", %{texts: texts} do
    assert texts["errors"]["unknown_reference"] == "There is nothing called %{name}."
    assert texts["errors"]["wrong_reference_kind"] =~ "%{name}"
    assert texts["offset"] == "Moved %{x} cm sideways and %{y} cm up or down"
  end

  test "has the error, status and unit texts the hook reads", %{texts: texts} do
    for kind <-
          ~w(syntax unknown_reference unknown_function wrong_argument_count division_by_zero
             circular_dependency wrong_reference_kind invalid_result no_intersection
             degenerate_geometry generic parameter_format) do
      assert texts["errors"][kind] =~ ~r/\S/, "no text for #{kind}"
    end

    assert texts["status"] == %{
             "saving" => "Saving…",
             "saved" => "Saved",
             "failed" => "Your changes could not be saved"
           }

    assert texts["units"] == %{
             "length" => "cm",
             "angle" => "degrees",
             "angle_per_length" => "degrees per cm",
             "number" => ""
           }

    assert texts["reset_offset"] == "Reset position"
    assert texts["decimal_separator"] == "."
  end

  test "encodes to JSON" do
    assert is_binary(JSON.encode!(EditorTexts.texts()))
  end
end
