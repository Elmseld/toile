defmodule Toile.Patterns.Blocks.LoaderTest do
  use ExUnit.Case, async: true

  alias Toile.Patterns.Blocks.Loader
  alias Toile.Patterns.DefinitionSize

  @moduletag :tmp_dir

  defp write!(dir, name, content) do
    path = Path.join(dir, name)
    File.write!(path, content)
    path
  end

  test "returns the key and the decoded definition", %{tmp_dir: dir} do
    path = write!(dir, "a_block.json", ~s({"version": 1, "measurements": ["waist"]}))

    assert Loader.load!(path) == {"a_block", %{"version" => 1, "measurements" => ["waist"]}}
  end

  test "raises for a key that is not snake_case", %{tmp_dir: dir} do
    path = write!(dir, "A-block.json", ~s({"version": 1, "measurements": []}))

    assert_raise CompileError, ~r/is not a snake_case block key/, fn -> Loader.load!(path) end
  end

  test "raises for a definition without the required shape", %{tmp_dir: dir} do
    for content <- [
          ~s([]),
          ~s({"measurements": []}),
          ~s({"version": "1", "measurements": []}),
          ~s({"version": 1}),
          ~s({"version": 1, "measurements": [1]})
        ] do
      path = write!(dir, "block.json", content)

      assert_raise CompileError, ~r/must be a JSON object/, fn -> Loader.load!(path) end
    end
  end

  test "loads imports of <part>.<value> references", %{tmp_dir: dir} do
    content =
      ~s({"version": 1, "measurements": [], "imports": {"armhole": "bodice.armhole_length"}})

    path = write!(dir, "sleeve.json", content)

    assert {"sleeve", %{"imports" => %{"armhole" => "bodice.armhole_length"}}} =
             Loader.load!(path)
  end

  test "raises for malformed imports", %{tmp_dir: dir} do
    for imports <- [
          ~s([]),
          ~s("bodice.armhole_length"),
          ~s({"armhole": 5}),
          ~s({"armhole": "armhole_length"}),
          ~s({"armhole": "bodice.armhole.length"}),
          ~s({"armhole": "1bodice.armhole"}),
          ~s({"armhole": "bodice.arm-hole"}),
          ~s({"armhole": "bodice.armhole\\n"})
        ] do
      path =
        write!(dir, "block.json", ~s({"version": 1, "measurements": [], "imports": #{imports}}))

      assert_raise CompileError, ~r/"imports" must be a JSON object of references/, fn ->
        Loader.load!(path)
      end
    end
  end

  test "raises for a definition larger than a project may store", %{tmp_dir: dir} do
    source = String.duplicate("a", DefinitionSize.max_bytes())
    content = JSON.encode!(%{"version" => 1, "measurements" => [], "source" => source})
    path = write!(dir, "big.json", content)

    message = ~r/more than #{DefinitionSize.max_bytes()} bytes/
    assert_raise CompileError, message, fn -> Loader.load!(path) end
  end

  test "accepts a definition at the cap", %{tmp_dir: dir} do
    overhead = byte_size(JSON.encode!(%{"measurements" => [], "source" => "", "version" => 1}))
    source = String.duplicate("a", DefinitionSize.max_bytes() - overhead)
    definition = %{"version" => 1, "measurements" => [], "source" => source}
    assert byte_size(JSON.encode!(definition)) == DefinitionSize.max_bytes()

    path = write!(dir, "fits.json", JSON.encode!(definition))

    assert {"fits", ^definition} = Loader.load!(path)
  end
end
