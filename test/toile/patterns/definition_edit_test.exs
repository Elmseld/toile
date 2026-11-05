defmodule Toile.Patterns.DefinitionEditTest do
  use ExUnit.Case, async: true

  alias Toile.Patterns.Blocks
  alias Toile.Patterns.DefinitionEdit

  doctest DefinitionEdit

  setup do
    %{stored: Blocks.definition("bodice")}
  end

  defp index_of(definition, name),
    do: Enum.find_index(definition["points"], &(&1["name"] == name))

  defp update_point(definition, name, fun) do
    index = index_of(definition, name)
    update_in(definition, ["points", Access.at(index)], fun)
  end

  defp path(definition, name, rest), do: "/points/#{index_of(definition, name)}#{rest}"

  describe "accepted" do
    test "an unchanged definition", %{stored: stored} do
      assert DefinitionEdit.validate(stored, stored) == :ok
    end

    test "adding, changing and removing a user_offset", %{stored: stored} do
      with_offset =
        update_point(stored, "b_arm_c1", &Map.put(&1, "user_offset", %{"dx" => 12.5, "dy" => -3}))

      assert DefinitionEdit.validate(stored, with_offset) == :ok

      changed =
        update_point(
          with_offset,
          "b_arm_c1",
          &Map.put(&1, "user_offset", %{"dx" => 0, "dy" => 10_000_000})
        )

      assert DefinitionEdit.validate(with_offset, changed) == :ok
      assert DefinitionEdit.validate(with_offset, stored) == :ok
    end

    test "changing formula fields", %{stored: stored} do
      submitted =
        stored
        |> update_point("b_arm_c1", &Map.put(&1, "distance", "20"))
        |> update_point("b_neck", &Map.put(&1, "dx", "neck_width + 5"))
        |> update_point("f_bdart_arm", &Map.put(&1, "angle", "bust_dart_angle"))
        |> update_point("b_shoulder", &Map.put(&1, "radius", ""))

      assert DefinitionEdit.validate(stored, submitted) == :ok
    end

    test "a formula of exactly 10 000 characters", %{stored: stored} do
      submitted = update_point(stored, "b_nape", &Map.put(&1, "x", String.duplicate("1", 10_000)))
      assert DefinitionEdit.validate(stored, submitted) == :ok
    end

    test "numbers that are equal as numbers", %{stored: stored} do
      submitted = put_in(stored, ["parameters", "ease_bust"], 80.0)
      assert DefinitionEdit.validate(stored, submitted) == :ok
    end
  end

  describe "boundaries and numbers" do
    test "an offset of exactly plus or minus 10 000 000 is accepted", %{stored: stored} do
      for value <- [10_000_000, -10_000_000, 10_000_000.0] do
        submitted =
          update_point(
            stored,
            "b_neck",
            &Map.put(&1, "user_offset", %{"dx" => value, "dy" => -value})
          )

        assert DefinitionEdit.validate(stored, submitted) == :ok, inspect(value)
      end
    end

    test "an integer and a float of the same value are equal outside points", %{stored: stored} do
      [{name, default} | _] = Enum.filter(stored["parameters"], fn {_, v} -> is_integer(v) end)
      submitted = put_in(stored, ["parameters", name], default * 1.0)
      assert DefinitionEdit.validate(stored, submitted) == :ok

      submitted = put_in(stored, ["parameters", name], default + 0.5)
      assert DefinitionEdit.validate(stored, submitted) == {:error, "/parameters/#{name}"}
    end
  end

  describe "rejected" do
    test "a renamed point", %{stored: stored} do
      submitted = update_point(stored, "b_neck", &Map.put(&1, "name", "b_neck2"))

      assert DefinitionEdit.validate(stored, submitted) ==
               {:error, path(stored, "b_neck", "/name")}
    end

    test "a changed op", %{stored: stored} do
      submitted = update_point(stored, "f_chest_mid", &Map.put(&1, "op", "offset"))

      assert DefinitionEdit.validate(stored, submitted) ==
               {:error, path(stored, "f_chest_mid", "/op")}
    end

    test "a changed name field", %{stored: stored} do
      submitted = update_point(stored, "b_neck", &Map.put(&1, "from", "b_waist_cb"))

      assert DefinitionEdit.validate(stored, submitted) ==
               {:error, path(stored, "b_neck", "/from")}
    end

    test "a changed line field", %{stored: stored} do
      submitted =
        update_point(stored, "b_arm_corner", &Map.put(&1, "line1", ["b_nape", "b_arm_width_dir"]))

      assert DefinitionEdit.validate(stored, submitted) ==
               {:error, path(stored, "b_arm_corner", "/line1/0")}
    end

    test "a changed which", %{stored: stored} do
      submitted = update_point(stored, "b_shoulder", &Map.put(&1, "which", "first"))

      assert DefinitionEdit.validate(stored, submitted) ==
               {:error, path(stored, "b_shoulder", "/which")}
    end

    test "an added or removed point field", %{stored: stored} do
      added = update_point(stored, "b_neck", &Map.put(&1, "to", "b_nape"))
      assert DefinitionEdit.validate(stored, added) == {:error, path(stored, "b_neck", "/to")}

      removed = update_point(stored, "b_neck", &Map.delete(&1, "dx"))
      assert DefinitionEdit.validate(stored, removed) == {:error, path(stored, "b_neck", "/dx")}
    end

    test "an added, removed or reordered point", %{stored: stored} do
      points = stored["points"]
      extra = %{"name" => "extra", "op" => "start", "x" => "0", "y" => "0"}

      assert DefinitionEdit.validate(stored, %{stored | "points" => points ++ [extra]}) ==
               {:error, "/points"}

      assert DefinitionEdit.validate(stored, %{stored | "points" => tl(points)}) ==
               {:error, "/points"}

      [first, second | rest] = points

      assert DefinitionEdit.validate(stored, %{stored | "points" => [second, first | rest]}) ==
               {:error, "/points/0/dx"}
    end

    test "points that are not a list, or a point that is not a map", %{stored: stored} do
      assert DefinitionEdit.validate(stored, %{stored | "points" => %{}}) == {:error, "/points"}

      submitted = %{stored | "points" => ["b_nape" | tl(stored["points"])]}
      assert DefinitionEdit.validate(stored, submitted) == {:error, "/points/0"}
    end

    test "changed, removed or added named formulas", %{stored: stored} do
      changed = put_in(stored, ["formulas", "armhole_length"], "0")
      assert DefinitionEdit.validate(stored, changed) == {:error, "/formulas/armhole_length"}

      {_formula, formulas} = Map.pop(stored["formulas"], "back_armhole_length")
      removed = %{stored | "formulas" => formulas}
      assert DefinitionEdit.validate(stored, removed) == {:error, "/formulas/back_armhole_length"}

      added = put_in(stored, ["formulas", "extra"], "1")
      assert DefinitionEdit.validate(stored, added) == {:error, "/formulas/extra"}
    end

    test "a changed parameter default", %{stored: stored} do
      submitted = put_in(stored, ["parameters", "ease_bust"], 100)
      assert DefinitionEdit.validate(stored, submitted) == {:error, "/parameters/ease_bust"}
    end

    test "changed curves or pieces", %{stored: stored} do
      curves = update_in(stored, ["curves", Access.at(0), "c1"], fn _ -> "b_neck_c2" end)
      assert DefinitionEdit.validate(stored, curves) == {:error, "/curves/0/c1"}

      pieces =
        update_in(stored, ["pieces", Access.at(0), "grainline", "from"], fn _ -> "b_nape" end)

      assert DefinitionEdit.validate(stored, pieces) == {:error, "/pieces/0/grainline/from"}
    end

    test "changed measurements, version or name", %{stored: stored} do
      assert DefinitionEdit.validate(stored, %{stored | "measurements" => ["bust"]}) ==
               {:error, "/measurements"}

      assert DefinitionEdit.validate(stored, %{stored | "version" => 2}) == {:error, "/version"}
      assert DefinitionEdit.validate(stored, %{stored | "name" => "Mine"}) == {:error, "/name"}
    end

    test "an added or removed top-level key", %{stored: stored} do
      assert DefinitionEdit.validate(stored, Map.put(stored, "extra", 1)) == {:error, "/extra"}
      assert DefinitionEdit.validate(stored, Map.delete(stored, "source")) == {:error, "/source"}
    end

    test "a bad user_offset", %{stored: stored} do
      expected = {:error, path(stored, "b_neck", "/user_offset")}

      for offset <- [
            %{"dx" => "1", "dy" => 0},
            %{"dx" => 0, "dy" => nil},
            %{"dx" => 10_000_001, "dy" => 0},
            %{"dx" => 0, "dy" => -1.0e8},
            %{"dx" => 0, "dy" => 0, "dz" => 0},
            %{"dx" => 0},
            [0, 0],
            nil
          ] do
        submitted = update_point(stored, "b_neck", &Map.put(&1, "user_offset", offset))
        assert DefinitionEdit.validate(stored, submitted) == expected, inspect(offset)
      end
    end

    test "a formula that is not a string or is too long", %{stored: stored} do
      expected = {:error, path(stored, "b_neck", "/dx")}

      for formula <- [12, nil, ["neck_width"], String.duplicate("1", 10_001)] do
        submitted = update_point(stored, "b_neck", &Map.put(&1, "dx", formula))
        assert DefinitionEdit.validate(stored, submitted) == expected
      end
    end

    test "a submitted definition that is not a map", %{stored: stored} do
      for submitted <- [nil, "x", [], 1] do
        assert DefinitionEdit.validate(stored, submitted) == {:error, ""}
      end
    end
  end

  describe "an unknown op" do
    setup do
      point = %{"name" => "A", "op" => "future", "x" => "0"}
      %{stored: %{"version" => 1, "points" => [point]}}
    end

    test "allows only a user_offset change", %{stored: stored} do
      with_offset =
        put_in(stored, ["points", Access.at(0), "user_offset"], %{"dx" => 1, "dy" => 2})

      assert DefinitionEdit.validate(stored, with_offset) == :ok

      changed = put_in(stored, ["points", Access.at(0), "x"], "1")
      assert DefinitionEdit.validate(stored, changed) == {:error, "/points/0/x"}
    end
  end

  test "escapes keys in paths" do
    stored = %{"formulas" => %{"a/b~c" => "1"}, "points" => []}
    submitted = put_in(stored, ["formulas", "a/b~c"], "2")
    assert DefinitionEdit.validate(stored, submitted) == {:error, "/formulas/a~1b~0c"}
  end
end
