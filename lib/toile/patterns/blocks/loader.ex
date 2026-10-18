defmodule Toile.Patterns.Blocks.Loader do
  @moduledoc """
  Reads and checks one block file for `Toile.Patterns.Blocks` at compile time.

  Kept apart from the catalogue so the checks can be tested on files that would not compile.
  Only the shape is checked, never the geometry: the key (file name) must be a snake_case
  identifier (`^[a-z][a-z0-9_]*$`), the content a JSON object with an integer `"version"` and a
  `"measurements"` list of strings, and the encoded definition no larger than
  `Toile.Patterns.DefinitionSize.max_bytes/0`, the cap a project's definition is stored under.
  """

  alias Toile.Patterns.DefinitionSize

  @key_format ~r/\A[a-z][a-z0-9_]*\z/

  @doc """
  Reads the block file at `path` and returns `{key, definition}`.

  Raises `CompileError` when the file breaks one of the rules in the moduledoc, so a bad block
  fails the build instead of every create of a project from it.
  """
  @spec load!(Path.t()) :: {String.t(), map()}
  def load!(path) do
    key = Path.basename(path, ".json")

    if not Regex.match?(@key_format, key) do
      raise CompileError, description: "#{path}: #{inspect(key)} is not a snake_case block key"
    end

    definition = path |> File.read!() |> JSON.decode!()

    if not valid_shape?(definition) do
      raise CompileError,
        description:
          "#{path} must be a JSON object with an integer \"version\" and a " <>
            "\"measurements\" list of strings"
    end

    if DefinitionSize.too_large?(definition) do
      raise CompileError,
        description:
          "#{path} encodes to more than #{DefinitionSize.max_bytes()} bytes of JSON, " <>
            "the most a pattern project can store"
    end

    {key, definition}
  end

  defp valid_shape?(%{"version" => version, "measurements" => measurements})
       when is_integer(version) and is_list(measurements),
       do: Enum.all?(measurements, &is_binary/1)

  defp valid_shape?(_definition), do: false
end
