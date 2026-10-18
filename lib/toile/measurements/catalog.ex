defmodule Toile.Measurements.Catalog do
  @moduledoc """
  The fixed list of body measurement keys a profile can hold.

  The keys are read at compile time from `engine/src/measurements.json`, the single list shared
  with the pattern engine (`docs/adr/0005-measurement-keys.md`). Editing that file recompiles this
  module and its dependents. The file is validated here: it must be a non-empty JSON array of
  unique strings, each a snake_case formula identifier (`^[a-z][a-z0-9_]*$`); otherwise
  compilation fails.
  """

  @path Path.expand("../../../engine/src/measurements.json", __DIR__)
  @external_resource @path

  @key_format ~r/\A[a-z][a-z0-9_]*\z/

  raw_keys = @path |> File.read!() |> JSON.decode!()

  if not (is_list(raw_keys) and raw_keys != []) do
    raise CompileError,
      description: "#{@path} must be a non-empty JSON array of measurement keys"
  end

  for key <- raw_keys, not (is_binary(key) and Regex.match?(@key_format, key)) do
    raise CompileError,
      description: "#{@path}: #{inspect(key)} is not a snake_case measurement key"
  end

  if Enum.uniq(raw_keys) != raw_keys do
    raise CompileError,
      description:
        "#{@path}: measurement keys must be unique, got #{inspect(raw_keys -- Enum.uniq(raw_keys))} more than once"
  end

  # String.to_atom/1 is safe here: the input is the trusted, validated compile-time file.
  @keys Enum.map(raw_keys, &String.to_atom/1)

  @doc """
  Returns the measurement keys as atoms, in display order (the order of the JSON file).

      iex> Toile.Measurements.Catalog.keys() |> Enum.take(3)
      [:bust, :waist, :hip]
  """
  @spec keys() :: [atom()]
  def keys, do: @keys
end
