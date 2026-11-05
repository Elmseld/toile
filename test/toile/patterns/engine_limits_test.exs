defmodule Toile.Patterns.EngineLimitsTest do
  @moduledoc """
  Pins the server's bounds on editor values to the engine's constants, so the two cannot drift:
  `PatternProject`'s largest parameter override is the engine's `MAX_PARAMETER`
  (`engine/src/editor/units.ts`) and `DefinitionEdit`'s largest user offset is its
  `MAX_COORDINATE` (`engine/src/geometry/vector.ts`). `SeamAllowances`' largest allowance and
  its default are the engine's `MAX_SEAM_ALLOWANCE` and `DEFAULT_SEAM_ALLOWANCE`
  (`engine/src/geometry/seam-allowance.ts`). Each bound is checked at the edge: the engine's value
  is accepted and the next number up is rejected.
  """
  use ExUnit.Case, async: true

  alias Toile.Patterns.DefinitionEdit
  alias Toile.Patterns.PatternProject
  alias Toile.Patterns.SeamAllowances

  @engine Path.expand("../../../engine/src", __DIR__)

  # Reads `export const NAME = <number>;` from an engine source file.
  defp engine_constant(file, name) do
    source = File.read!(Path.join(@engine, file))
    [_, literal] = Regex.run(~r/export const #{name} = ([0-9_.e]+);/, source)
    literal = String.replace(literal, "_", "")

    case Integer.parse(literal) do
      {integer, ""} -> integer
      _other -> literal |> Float.parse() |> elem(0) |> trunc()
    end
  end

  test "parameter overrides are bounded by the engine's MAX_PARAMETER" do
    max = engine_constant("editor/units.ts", "MAX_PARAMETER")
    project = %PatternProject{definition: %{"parameters" => %{"ease" => 0}}, parameters: %{}}

    valid? = fn value ->
      attrs = %{"definition" => project.definition, "parameters" => %{"ease" => value}}
      PatternProject.edit_changeset(project, attrs, nil).valid?
    end

    assert valid?.(max)
    assert valid?.(-max)
    refute valid?.(max + 1)
    refute valid?.(-max - 1)
  end

  test "user offsets are bounded by the engine's MAX_COORDINATE" do
    max = engine_constant("geometry/vector.ts", "MAX_COORDINATE")
    stored = %{"points" => [%{"name" => "A", "op" => "start", "x" => "0", "y" => "0"}]}

    validate = fn dx ->
      submitted =
        put_in(stored, ["points", Access.at(0), "user_offset"], %{"dx" => dx, "dy" => 0})

      DefinitionEdit.validate(stored, submitted)
    end

    assert validate.(max) == :ok
    assert validate.(-max) == :ok
    assert validate.(max + 1) == {:error, "/points/0/user_offset"}
  end

  test "seam allowances are bounded by the engine's MAX_SEAM_ALLOWANCE" do
    max = engine_constant("geometry/seam-allowance.ts", "MAX_SEAM_ALLOWANCE")
    assert SeamAllowances.max_mm() == max
    curves = %{"skirt" => MapSet.new(["hem"])}

    valid? = fn default, edge ->
      attrs = %{"default" => default, "edges" => %{"skirt" => %{"hem" => edge}}}
      SeamAllowances.changeset(%SeamAllowances{}, attrs, curves).valid?
    end

    assert valid?.(max, max)
    assert valid?.(0, 0)
    refute valid?.(max + 1, 0)
    refute valid?.(0, max + 1)
  end

  test "a new project's seam allowance is the engine's DEFAULT_SEAM_ALLOWANCE" do
    default = engine_constant("geometry/seam-allowance.ts", "DEFAULT_SEAM_ALLOWANCE")
    assert SeamAllowances.default_mm() == default
    assert %SeamAllowances{}.default == default
  end
end
