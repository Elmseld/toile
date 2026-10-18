defmodule ToileWeb.BlockTextsTest do
  use ExUnit.Case, async: true

  alias Toile.Patterns.Blocks
  alias ToileWeb.BlockTexts

  doctest BlockTexts

  # Fails (FunctionClauseError) when a block file is added to engine/blocks/ without a label.
  test "every block has a label" do
    for key <- Blocks.keys() do
      assert BlockTexts.label(key) =~ ~r/\S/, "#{key} has an empty label"
    end
  end

  test "block labels are distinct" do
    labels = Enum.map(Blocks.keys(), &BlockTexts.label/1)

    assert Enum.uniq(labels) == labels
  end

  test "every piece of every block has a label of its own" do
    for key <- Blocks.keys(), %{"name" => name} <- Blocks.definition(key)["pieces"] do
      assert BlockTexts.piece_label(name) != name, "piece #{name} of #{key} has no label"
    end
  end

  test "labels the skirt pieces and falls back to the piece name" do
    assert BlockTexts.piece_label("back") == "Back"
    assert BlockTexts.piece_label("front") == "Front"
    assert BlockTexts.piece_label("sleeve") == "sleeve"
  end
end
