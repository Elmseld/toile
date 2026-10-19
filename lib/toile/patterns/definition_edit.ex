defmodule Toile.Patterns.DefinitionEdit do
  @moduledoc """
  Decides whether an edited pattern definition may replace the stored one
  (`docs/adr/0008-pattern-editor.md`).

  The editor in the browser owns the working definition and saves it whole. The server cannot
  check formulas or geometry (only the engine can), so it checks the shape of the change instead:
  the submitted definition must equal the stored one except in the places the editor may change.

    * The top-level keys are the same, and every top-level value except `"points"` is equal
      (`==`, so `1 == 1.0`): `version`, `name`, `source`, `measurements`, `parameters` (the
      defaults), `formulas`, `curves` and `pieces`. That keeps the named formulas other features
      read, such as the bodice's `armhole_length`, out of reach.
    * `"points"` has the same length, and each point has the same `"name"`, `"op"` and keys,
      apart from `"user_offset"`, which may be added, changed or removed.
    * A formula field of the point's op (`Toile.Patterns.PointOps.formula_fields/1`) may change to
      any string of at most 10 000 characters (the formula length limit of ADR 0003). Every
      other field is unchanged. An unknown op allows only the `user_offset` change.
    * A `user_offset` is exactly `%{"dx" => dx, "dy" => dy}` with numbers of at most
      10 000 000 mm (10 km) in absolute value (the engine's `MAX_COORDINATE`).

  Whether the new formulas parse and the geometry computes is the client's business: it only
  saves a definition the engine evaluated without errors, and a bad formula breaks nobody's
  pattern but the user's own. Pure; no geometry is computed.
  """

  alias Toile.Patterns.PointOps

  @max_formula_length 10_000
  # The engine's MAX_COORDINATE; test/toile/patterns/engine_limits_test.exs keeps the two equal.
  @max_offset 10_000_000

  @doc """
  Returns `:ok` if `submitted` differs from `stored` only where the editor may change a
  definition, else `{:error, path}` with the JSON pointer of the first violation found.

  The path is for logs and tests; it is not shown to users.

  ## Examples

      iex> stored = %{"version" => 1, "points" => [%{"name" => "A", "op" => "start", "x" => "0", "y" => "0"}]}
      iex> Toile.Patterns.DefinitionEdit.validate(stored, put_in(stored, ["points", Access.at(0), "x"], "10"))
      :ok
      iex> Toile.Patterns.DefinitionEdit.validate(stored, put_in(stored, ["points", Access.at(0), "name"], "B"))
      {:error, "/points/0/name"}
  """
  @spec validate(map(), term()) :: :ok | {:error, String.t()}
  def validate(stored, submitted) when is_map(stored) and is_map(submitted) do
    with :ok <- same_keys(stored, submitted, ""),
         :ok <- validate_sections(stored, submitted) do
      validate_points(stored["points"], submitted["points"])
    end
  end

  def validate(stored, _submitted) when is_map(stored), do: {:error, ""}

  defp validate_sections(stored, submitted) do
    stored
    |> Map.delete("points")
    |> Enum.sort()
    |> first_error(fn {key, value} -> equal(value, submitted[key], pointer("", key)) end)
  end

  defp validate_points(stored, submitted) when is_list(stored) and is_list(submitted) do
    if length(stored) == length(submitted) do
      stored
      |> Enum.zip(submitted)
      |> Enum.with_index()
      |> first_error(fn {{old, new}, index} -> validate_point(old, new, "/points/#{index}") end)
    else
      {:error, "/points"}
    end
  end

  defp validate_points(stored, submitted), do: equal(stored, submitted, "/points")

  defp validate_point(old, new, path) when is_map(old) and is_map(new) do
    with :ok <- same_keys(Map.delete(old, "user_offset"), Map.delete(new, "user_offset"), path),
         :ok <- equal(old["name"], new["name"], path <> "/name"),
         :ok <- equal(old["op"], new["op"], path <> "/op"),
         :ok <- validate_offset(new, path) do
      formulas = PointOps.formula_fields(old["op"]) || []

      old
      |> Map.drop(["name", "op", "user_offset"])
      |> Enum.sort()
      |> first_error(fn {field, value} ->
        field_path = pointer(path, field)

        if field in formulas,
          do: validate_formula(new[field], field_path),
          else: equal(value, new[field], field_path)
      end)
    end
  end

  defp validate_point(old, new, path), do: equal(old, new, path)

  defp validate_offset(%{"user_offset" => offset}, path) do
    case offset do
      %{"dx" => dx, "dy" => dy} when map_size(offset) == 2 ->
        if coordinate?(dx) and coordinate?(dy), do: :ok, else: {:error, path <> "/user_offset"}

      _other ->
        {:error, path <> "/user_offset"}
    end
  end

  defp validate_offset(_point, _path), do: :ok

  defp coordinate?(value), do: is_number(value) and abs(value) <= @max_offset

  defp validate_formula(value, path) do
    if is_binary(value) and String.length(value) <= @max_formula_length,
      do: :ok,
      else: {:error, path}
  end

  defp same_keys(old, new, path) do
    old_keys = old |> Map.keys() |> MapSet.new()
    new_keys = new |> Map.keys() |> MapSet.new()

    case old_keys |> MapSet.symmetric_difference(new_keys) |> Enum.sort() do
      [] -> :ok
      [key | _rest] -> {:error, pointer(path, key)}
    end
  end

  # The pointer of the first place where `new` differs from `old`, for a useful log line.
  defp equal(old, new, path) when is_map(old) and is_map(new) do
    with :ok <- same_keys(old, new, path) do
      old
      |> Enum.sort()
      |> first_error(fn {key, value} ->
        equal(value, Map.fetch!(new, key), pointer(path, key))
      end)
    end
  end

  defp equal(old, new, path) when is_list(old) and is_list(new) do
    if length(old) == length(new) do
      old
      |> Enum.zip(new)
      |> Enum.with_index()
      |> first_error(fn {{a, b}, index} -> equal(a, b, "#{path}/#{index}") end)
    else
      {:error, path}
    end
  end

  defp equal(old, new, path) do
    if old == new, do: :ok, else: {:error, path}
  end

  defp first_error(enumerable, check) do
    Enum.find_value(enumerable, :ok, fn item ->
      case check.(item) do
        :ok -> nil
        error -> error
      end
    end)
  end

  defp pointer(path, key), do: "#{path}/#{escape(key)}"

  # RFC 6901: "~" and "/" in a key are escaped. Keys of decoded JSON are strings.
  defp escape(key),
    do: key |> to_string() |> String.replace("~", "~0") |> String.replace("/", "~1")
end
