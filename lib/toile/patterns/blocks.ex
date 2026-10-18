defmodule Toile.Patterns.Blocks do
  @moduledoc """
  The block catalogue: the pattern definitions a new pattern project can start from.

  Blocks are data in `engine/blocks/<key>.json`, read here at compile time
  (`docs/adr/0006-pattern-projects-and-blocks.md`). Editing a file recompiles this module, and so
  does adding or removing one. Only the shape is checked: the key (file name) must be a
  snake_case identifier (`^[a-z][a-z0-9_]*$`) and the content a JSON object with an integer
  `"version"` and a `"measurements"` list of strings; otherwise compilation fails. The geometry is
  never interpreted here: the engine validates and evaluates the definition in the browser.
  """

  @dir Path.expand("../../../engine/blocks", __DIR__)
  @pattern Path.join(@dir, "*.json")

  @key_format ~r/\A[a-z][a-z0-9_]*\z/

  @paths @pattern |> Path.wildcard() |> Enum.sort()

  for path <- @paths do
    @external_resource path
  end

  if @paths == [] do
    raise CompileError, description: "#{@dir} has no block definitions (*.json)"
  end

  @blocks Map.new(@paths, fn path ->
            key = Path.basename(path, ".json")

            unless Regex.match?(@key_format, key) do
              raise CompileError,
                description: "#{path}: #{inspect(key)} is not a snake_case block key"
            end

            definition = path |> File.read!() |> JSON.decode!()

            unless is_map(definition) and is_integer(definition["version"]) and
                     is_list(definition["measurements"]) and
                     Enum.all?(definition["measurements"], &is_binary/1) do
              raise CompileError,
                description:
                  "#{path} must be a JSON object with an integer \"version\" and a " <>
                    "\"measurements\" list of strings"
            end

            {key, definition}
          end)

  @keys @blocks |> Map.keys() |> Enum.sort()

  @doc false
  # Recompile when a block file is added or removed (`@external_resource` only covers edits).
  def __mix_recompile__? do
    @pattern |> Path.wildcard() |> Enum.sort() != @paths
  end

  @doc """
  Returns the block keys, sorted.

      iex> "straight_skirt" in Toile.Patterns.Blocks.keys()
      true
  """
  @spec keys() :: [String.t()]
  def keys, do: @keys

  @doc """
  Returns whether `key` names a block.

      iex> Toile.Patterns.Blocks.exists?("straight_skirt")
      true

      iex> Toile.Patterns.Blocks.exists?("nope")
      false
  """
  @spec exists?(term()) :: boolean()
  def exists?(key), do: Map.has_key?(@blocks, key)

  @doc """
  Returns the pattern definition of the block `key` as decoded JSON (string keys).

  Raises `ArgumentError` for an unknown key; check with `exists?/1` first for untrusted input.
  """
  @spec definition(String.t()) :: map()
  def definition(key) do
    case Map.fetch(@blocks, key) do
      {:ok, definition} -> definition
      :error -> raise ArgumentError, "unknown block #{inspect(key)}"
    end
  end
end
