defmodule Toile.Patterns.SeamAllowances do
  @moduledoc """
  A project's seam allowances, in mm (`docs/adr/0011-markings-and-seam-allowance-storage.md`):
  `default` for every edge, and `edges`, the user's own values by part name and curve name,
  `%{"<part>" => %{"<curve>" => mm}}`. Embedded in `Toile.Patterns.PatternProject`.

  Stored outside the definitions, so the editor never edits pieces (ADR 0008). The engine applies
  them (`pieceSeamAllowances`): a fold edge gets 0 unless the user set a value for it, and every
  other edge without a value gets `default`. Elixir only checks names and ranges.
  """

  use Ecto.Schema
  use Gettext, backend: ToileWeb.Gettext
  import Ecto.Changeset

  # The engine's MAX_SEAM_ALLOWANCE and DEFAULT_SEAM_ALLOWANCE
  # (engine/src/geometry/seam-allowance.ts); test/toile/patterns/engine_limits_test.exs keeps them
  # equal.
  @max_mm 100
  @default_mm 10

  @primary_key false
  embedded_schema do
    field :default, :float, default: @default_mm * 1.0
    field :edges, :map, default: %{}
  end

  @type t :: %__MODULE__{default: float(), edges: %{optional(String.t()) => map()}}

  @doc "Returns the largest seam allowance accepted, in mm."
  @spec max_mm() :: pos_integer()
  def max_mm, do: @max_mm

  @doc "Returns the seam allowance of a new project, in mm."
  @spec default_mm() :: pos_integer()
  def default_mm, do: @default_mm

  @doc """
  Changeset for saving the allowances from the editor.

  `attrs` needs `default` and `edges`. `default` must be a JSON number (not a string) from 0 to
  `max_mm/0`. `edges` must be a map whose every key is a part in `outline_curves` and every value
  a map; each inner key must be a curve in that part's set and each inner value a number from 0
  to `max_mm/0`. `outline_curves` maps each part name of the project to the `MapSet` of curve
  names in its pieces' outlines. Keys are compared as strings and never turned into atoms.

  ## Examples

      iex> curves = %{"straight_skirt" => MapSet.new(["f_cf"])}
      iex> attrs = %{"default" => 15, "edges" => %{"straight_skirt" => %{"f_cf" => 0}}}
      iex> Toile.Patterns.SeamAllowances.changeset(%Toile.Patterns.SeamAllowances{}, attrs, curves).valid?
      true

  """
  def changeset(seam_allowances, attrs, outline_curves) when is_map(outline_curves) do
    seam_allowances
    |> cast(attrs, [:default, :edges])
    |> validate_required([:default, :edges])
    |> validate_raw_number(attrs, :default)
    |> validate_number(:default, greater_than_or_equal_to: 0, less_than_or_equal_to: @max_mm)
    |> validate_change(:edges, fn :edges, edges ->
      if valid_edges?(edges, outline_curves),
        do: [],
        else: [edges: dgettext_noop("errors", "is invalid")]
    end)
  end

  # `cast/3` turns a string such as "10" into a float; the client sends numbers, so a string is
  # rejected rather than read.
  defp validate_raw_number(changeset, attrs, field) do
    raw = Map.get(attrs, Atom.to_string(field), Map.get(attrs, field))

    if is_nil(raw) or is_number(raw) do
      changeset
    else
      add_error(changeset, field, dgettext_noop("errors", "is invalid"))
    end
  end

  defp valid_edges?(edges, outline_curves) do
    Enum.all?(edges, fn {part, curves} ->
      case Map.fetch(outline_curves, part) do
        {:ok, known} when is_map(curves) ->
          Enum.all?(curves, fn {curve, value} ->
            MapSet.member?(known, curve) and valid_mm?(value)
          end)

        _unknown_part_or_not_a_map ->
          false
      end
    end)
  end

  defp valid_mm?(value), do: is_number(value) and value >= 0 and value <= @max_mm

  @doc """
  Returns the allowances as the plain map the project page encodes for the engine:
  `%{"default" => mm, "edges" => %{part => %{curve => mm}}}`.

  ## Examples

      iex> Toile.Patterns.SeamAllowances.to_map(%Toile.Patterns.SeamAllowances{})
      %{"default" => 10.0, "edges" => %{}}

  """
  @spec to_map(t()) :: %{String.t() => number() | map()}
  def to_map(%__MODULE__{default: default, edges: edges}),
    do: %{"default" => default, "edges" => edges}
end
