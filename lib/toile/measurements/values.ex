defmodule Toile.Measurements.Values do
  @moduledoc """
  The body measurements of a profile, embedded in `measurement_profiles.measurements` (jsonb).

  There is one integer field per key of `Toile.Measurements.Catalog`, holding millimetres.
  `nil` (stored as `null` or absent) means the measurement has not been taken; any subset of the
  keys may be filled in. Unknown keys in params are dropped by `cast/4`.

  The web layer converts the centimetres the user types into millimetres before calling the
  context, so this schema only ever sees millimetres. Error messages are user-facing and
  therefore state the limits in centimetres.
  """

  use Ecto.Schema
  use Gettext, backend: ToileWeb.Gettext
  import Ecto.Changeset

  alias Toile.Measurements.Catalog

  @min_mm 1
  @max_mm 3000

  @primary_key false
  embedded_schema do
    for key <- Catalog.keys() do
      field key, :integer
    end
  end

  @doc """
  Casts and validates measurement values given in millimetres.

  A value must be an integer between #{@min_mm} and #{@max_mm} mm (0.1 to 300 cm). Empty values
  clear the measurement.
  """
  def changeset(values, attrs) do
    keys = Catalog.keys()

    values
    |> cast(attrs, keys, message: &cast_message/2)
    |> validate_range(keys)
  end

  defp cast_message(_field, _meta),
    do: dgettext_noop("errors", "must be a number in cm with at most one decimal")

  defp validate_range(changeset, keys) do
    Enum.reduce(keys, changeset, fn key, changeset ->
      validate_number(changeset, key,
        greater_than_or_equal_to: @min_mm,
        less_than_or_equal_to: @max_mm,
        message: dgettext_noop("errors", "must be more than 0 and at most 300 cm")
      )
    end)
  end
end
