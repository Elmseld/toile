defmodule Toile.Patterns.PointOps do
  @moduledoc """
  The field layout of every point operation of the pattern definition format.

  Read at compile time from `engine/src/geometry/point_ops.json`, the table the engine itself
  uses (`docs/adr/0008-pattern-editor.md`), so both sides agree on which point fields are
  formulas. Editing the file recompiles this module and its dependents. The file must be a
  non-empty JSON object from snake_case op names to non-empty lists of `[field, kind]` pairs,
  with `kind` one of `"name"`, `"formula"`, `"line"` and `"which"`; otherwise compilation fails.

  `Toile.Patterns.DefinitionEdit` uses it to tell which fields of a stored point the editor may
  change.
  """

  @path Path.expand("../../../engine/src/geometry/point_ops.json", __DIR__)
  @external_resource @path

  @name_format ~r/\A[a-z][a-z0-9_]*\z/
  @kinds ~w(name formula line which)

  raw = @path |> File.read!() |> JSON.decode!()

  if not (is_map(raw) and map_size(raw) > 0) do
    raise CompileError, description: "#{@path} must be a non-empty JSON object of point ops"
  end

  for {op, fields} <- raw do
    if not (is_binary(op) and Regex.match?(@name_format, op)) do
      raise CompileError, description: "#{@path}: #{inspect(op)} is not a snake_case op name"
    end

    if not (is_list(fields) and fields != []) do
      raise CompileError, description: "#{@path}: #{op} must have a non-empty list of fields"
    end

    for spec <- fields do
      valid? =
        match?([field, kind] when is_binary(field) and is_binary(kind), spec) and
          Regex.match?(@name_format, hd(spec)) and List.last(spec) in @kinds

      if not valid? do
        raise CompileError,
          description: "#{@path}: #{op} has an invalid field #{inspect(spec)}"
      end
    end

    names = Enum.map(fields, &hd/1)

    if Enum.uniq(names) != names do
      raise CompileError, description: "#{@path}: #{op} lists a field more than once"
    end
  end

  @fields Map.new(raw, fn {op, fields} -> {op, Enum.map(fields, &hd/1)} end)

  @formula_fields Map.new(raw, fn {op, fields} ->
                    {op, for([field, "formula"] <- fields, do: field)}
                  end)

  @ops raw |> Map.keys() |> Enum.sort()

  @doc """
  Returns every op name, sorted.

      iex> "midpoint" in Toile.Patterns.PointOps.ops()
      true
  """
  @spec ops() :: [String.t()]
  def ops, do: @ops

  @doc """
  Returns the fields of `op` in the engine's order, or `nil` for an unknown op.

      iex> Toile.Patterns.PointOps.fields("offset")
      ["from", "dx", "dy"]

      iex> Toile.Patterns.PointOps.fields("nope")
      nil
  """
  @spec fields(term()) :: [String.t()] | nil
  def fields(op), do: Map.get(@fields, op)

  @doc """
  Returns the formula fields of `op` in the engine's order, or `nil` for an unknown op.

      iex> Toile.Patterns.PointOps.formula_fields("along_angle")
      ["angle", "distance"]

      iex> Toile.Patterns.PointOps.formula_fields("midpoint")
      []
  """
  @spec formula_fields(term()) :: [String.t()] | nil
  def formula_fields(op), do: Map.get(@formula_fields, op)
end
