defmodule Toile.Patterns.SeamAllowancesTest do
  use ExUnit.Case, async: true

  alias Toile.Patterns.SeamAllowances

  doctest SeamAllowances

  @curves %{
    "straight_skirt" => MapSet.new(["f_cf", "b_side_lower", "f_hem"]),
    "straight_sleeve" => MapSet.new(["s_hem"])
  }

  defp changeset(attrs), do: SeamAllowances.changeset(%SeamAllowances{}, attrs, @curves)

  defp valid?(attrs), do: changeset(attrs).valid?

  defp with_default(default), do: %{"default" => default, "edges" => %{}}

  defp with_edges(edges), do: %{"default" => 10, "edges" => edges}

  test "a new value has the default of a new project and no edges" do
    assert %SeamAllowances{default: 10.0, edges: %{}} = %SeamAllowances{}
    assert SeamAllowances.default_mm() == 10
    assert SeamAllowances.max_mm() == 100
  end

  test "accepts defaults from 0 to the maximum" do
    for default <- [0, 10, 15.5, 100, 0.0, 100.0] do
      assert valid?(with_default(default)), "expected #{inspect(default)} to be accepted"
    end

    changeset = changeset(with_default(15))
    assert Ecto.Changeset.get_field(changeset, :default) == 15.0
  end

  test "rejects a default out of range, not a number, or missing" do
    for default <- [-1, -0.1, 100.1, 101, "10", "abc", nil, %{}, [1], true] do
      refute valid?(with_default(default)), "expected #{inspect(default)} to be rejected"
    end

    refute valid?(%{"edges" => %{}, "default" => nil})
    assert %{default: ["is invalid"]} = errors_on(changeset(with_default("10")))
  end

  test "accepts edges of known parts and curves, 0 included" do
    assert valid?(with_edges(%{"straight_skirt" => %{"f_cf" => 0, "b_side_lower" => 25.5}}))
    assert valid?(with_edges(%{"straight_skirt" => %{"f_hem" => 100}, "straight_sleeve" => %{}}))
    assert valid?(with_edges(%{"straight_sleeve" => %{"s_hem" => 40}}))
    assert valid?(with_edges(%{}))
  end

  test "rejects unknown parts and curves, a curve of another part and non-map parts" do
    for edges <- [
          %{"bodice" => %{"f_cf" => 0}},
          %{"straight_skirt" => %{"nope" => 0}},
          %{"straight_skirt" => %{"s_hem" => 10}},
          %{"straight_sleeve" => %{"f_cf" => 10}},
          %{"straight_skirt" => 10},
          %{"straight_skirt" => [10]},
          %{"straight_skirt" => nil}
        ] do
      refute valid?(with_edges(edges)), "expected #{inspect(edges)} to be rejected"
    end

    assert %{edges: ["is invalid"]} = errors_on(changeset(with_edges(%{"bodice" => %{}})))
  end

  test "rejects edge values out of range or not numbers" do
    for value <- [-0.5, 100.5, 101, "10", nil, true, %{}, [0]] do
      edges = %{"straight_skirt" => %{"f_cf" => value}}
      refute valid?(with_edges(edges)), "expected #{inspect(value)} to be rejected"
    end
  end

  test "rejects edges that are not a map, and atom keys never match" do
    refute valid?(with_edges([]))
    refute valid?(with_edges("x"))
    refute valid?(%{"default" => 10, "edges" => nil})
    refute valid?(with_edges(%{straight_skirt: %{"f_cf" => 0}}))
  end

  test "to_map/1 gives the plain map the page encodes" do
    value = %SeamAllowances{default: 12.5, edges: %{"straight_skirt" => %{"f_cf" => 0}}}

    assert SeamAllowances.to_map(value) == %{
             "default" => 12.5,
             "edges" => %{"straight_skirt" => %{"f_cf" => 0}}
           }
  end

  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, _opts} -> message end)
  end
end
