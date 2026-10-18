defmodule Toile.Patterns.DefinitionSize do
  @moduledoc """
  The size cap on a stored pattern definition, in bytes of encoded JSON.

  Shared by `Toile.Patterns.Blocks`, which refuses to compile a block over the cap, and
  `Toile.Patterns.PatternProject`, which refuses to store one. It lives in its own module so the
  block catalogue can use it at compile time without depending on the schema, which itself
  depends on the catalogue.
  """

  @max_bytes 1_000_000

  @doc """
  Returns the maximum size of a stored definition, in bytes of encoded JSON.
  """
  @spec max_bytes() :: pos_integer()
  def max_bytes, do: @max_bytes

  @doc """
  Returns whether `definition` encodes to more than `max_bytes/0` bytes of JSON.

      iex> Toile.Patterns.DefinitionSize.too_large?(%{"version" => 1})
      false
  """
  @spec too_large?(term()) :: boolean()
  def too_large?(definition), do: byte_size(JSON.encode!(definition)) > @max_bytes
end
