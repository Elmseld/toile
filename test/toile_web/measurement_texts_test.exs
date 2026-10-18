defmodule ToileWeb.MeasurementTextsTest do
  use ExUnit.Case, async: true

  alias Toile.Measurements
  alias ToileWeb.MeasurementTexts

  doctest MeasurementTexts

  # Fails (FunctionClauseError) when a key is added to engine/src/measurements.json
  # without a label and help text.
  test "every catalogue key has a label and a help text" do
    for key <- Measurements.keys() do
      assert MeasurementTexts.label(key) =~ ~r/\S/, "#{key} has an empty label"
      assert MeasurementTexts.help(key) =~ ~r/\S/, "#{key} has an empty help text"
    end
  end

  test "labels are distinct" do
    labels = Enum.map(Measurements.keys(), &MeasurementTexts.label/1)

    assert Enum.uniq(labels) == labels
  end
end
