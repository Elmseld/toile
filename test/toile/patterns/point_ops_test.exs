defmodule Toile.Patterns.PointOpsTest do
  use ExUnit.Case, async: true

  alias Toile.Patterns.Blocks
  alias Toile.Patterns.PointOps

  doctest PointOps

  @path Path.expand("../../../engine/src/geometry/point_ops.json", __DIR__)

  test "ops/0 lists the ops of engine/src/geometry/point_ops.json" do
    file_ops = @path |> File.read!() |> JSON.decode!() |> Map.keys() |> Enum.sort()

    assert PointOps.ops() == file_ops

    assert PointOps.ops() ==
             ~w(along_angle along_line line_circle_intersection line_intersection midpoint offset
                perpendicular start)
  end

  test "fields/1 and formula_fields/1 follow the file" do
    assert PointOps.fields("line_circle_intersection") == ~w(line center radius which)
    assert PointOps.formula_fields("line_circle_intersection") == ["radius"]
    assert PointOps.formula_fields("along_angle") == ["angle", "distance"]
    assert PointOps.formula_fields("start") == ["x", "y"]
    assert PointOps.formula_fields("line_intersection") == []
  end

  test "an unknown op has no fields" do
    assert PointOps.fields("__proto__") == nil
    assert PointOps.formula_fields("nope") == nil
    assert PointOps.formula_fields(nil) == nil
    assert PointOps.formula_fields(%{}) == nil
  end

  test "every op used by a block is known" do
    for key <- Blocks.keys(), %{"op" => op} <- Blocks.definition(key)["points"] do
      assert op in PointOps.ops(), "#{key} uses the unknown op #{op}"
    end
  end
end
