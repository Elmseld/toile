defmodule Toile.Patterns.DefinitionSizeTest do
  use ExUnit.Case, async: true

  alias Toile.Patterns.DefinitionSize
  alias Toile.Patterns.PatternProject

  doctest DefinitionSize

  test "the schema uses the shared cap" do
    assert PatternProject.max_definition_bytes() == DefinitionSize.max_bytes()
  end
end
