defmodule Toile.Patterns.DefinitionSize do
  @moduledoc """
  The size cap on a stored pattern definition, in bytes of encoded JSON.

  Shared by `Toile.Patterns.Blocks`, which refuses to compile a block over the cap, and
  `Toile.Patterns.PatternProject`, which refuses to store one. It lives in its own module so the
  block catalogue can use it at compile time without depending on the schema, which itself
  depends on the catalogue.

  The editor saves the whole definition with its parameter overrides in one LiveView event, and
  the websocket closes on a frame over `max_frame_size` (256 000 bytes, `ToileWeb.Endpoint`).
  So a save is capped at `max_save_bytes/0`, below the frame size with room for the event
  envelope, and a stored definition at `max_bytes/0`, below that with room for the overrides:
  every stored project can be saved again (`docs/adr/0008-pattern-editor.md`).
  `test/toile/patterns/definition_size_test.exs` checks the caps against the endpoint.
  """

  @max_bytes 200_000
  @max_save_bytes 240_000

  @doc """
  Returns the maximum size of a stored definition, in bytes of encoded JSON.
  """
  @spec max_bytes() :: pos_integer()
  def max_bytes, do: @max_bytes

  @doc """
  Returns the maximum size of an editor save: the definition and the parameter overrides, each
  in bytes of encoded JSON, added up.
  """
  @spec max_save_bytes() :: pos_integer()
  def max_save_bytes, do: @max_save_bytes

  @doc """
  Returns whether `definition` and `parameters` together encode to more than `max_save_bytes/0`
  bytes of JSON.

      iex> Toile.Patterns.DefinitionSize.save_too_large?(%{"version" => 1}, %{"ease" => 10})
      false
  """
  @spec save_too_large?(term(), term()) :: boolean()
  def save_too_large?(definition, parameters) do
    byte_size(JSON.encode!(definition)) + byte_size(JSON.encode!(parameters)) > @max_save_bytes
  end

  @doc """
  Returns whether `definition` encodes to more than `max_bytes/0` bytes of JSON.

      iex> Toile.Patterns.DefinitionSize.too_large?(%{"version" => 1})
      false
  """
  @spec too_large?(term()) :: boolean()
  def too_large?(definition), do: byte_size(JSON.encode!(definition)) > @max_bytes
end
