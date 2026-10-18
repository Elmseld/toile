defmodule Toile.Patterns.Blocks do
  @moduledoc """
  The block catalogue: the pattern definitions a new pattern project can start from.

  Blocks are data in `engine/blocks/<key>.json`, read here at compile time
  (`docs/adr/0006-pattern-projects-and-blocks.md`). Editing a file recompiles this module, and so
  does adding or removing one. Each file is checked by `Toile.Patterns.Blocks.Loader`: a
  snake_case key, a JSON object with an integer `"version"` and a `"measurements"` list of
  strings, and no larger than a project may store; otherwise compilation fails. The geometry is
  never interpreted here: the engine validates and evaluates the definition in the browser.
  """

  alias Toile.Patterns.Blocks.Loader

  @dir Path.expand("../../../engine/blocks", __DIR__)
  @pattern Path.join(@dir, "*.json")

  @paths @pattern |> Path.wildcard() |> Enum.sort()

  for path <- @paths do
    @external_resource path
  end

  if @paths == [] do
    raise CompileError, description: "#{@dir} has no block definitions (*.json)"
  end

  @blocks Map.new(@paths, &Loader.load!/1)

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
