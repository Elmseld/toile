defmodule ToileWeb.Centimeters do
  @moduledoc """
  Converts between the centimetres the UI shows and the integer millimetres the app stores.

  Lengths are millimetres everywhere in code and storage; only the UI shows centimetres, with
  exactly one decimal. Input accepts both `.` and `,` as decimal separator; output uses the
  separator of the current locale (`pgettext("decimal separator", ".")`, `,` in Swedish).
  Only integer arithmetic is used, never floats.
  """

  use Gettext, backend: ToileWeb.Gettext

  alias Toile.Measurements.Catalog

  # An optional sign, whole centimetres and at most one decimal. The sign is accepted so the
  # range validation reports negative values; `+` is accepted because Ecto's integer cast
  # would otherwise read a passed-through "+5" as 5 mm.
  @cm_format ~r/\A([-+]?)(\d+)(?:[.,](\d))?\z/

  @catalog_keys Enum.map(Catalog.keys(), &Atom.to_string/1)

  @doc """
  Parses a centimetre string into integer millimetres.

  Surrounding whitespace is ignored. Anything other than a whole number with at most one
  decimal (`.` or `,`) is `:error`. The range is not checked here.

      iex> ToileWeb.Centimeters.parse("72,5")
      {:ok, 725}

      iex> ToileWeb.Centimeters.parse(" 72 ")
      {:ok, 720}

      iex> ToileWeb.Centimeters.parse("72.55")
      :error
  """
  @spec parse(String.t()) :: {:ok, integer()} | :error
  def parse(string) when is_binary(string) do
    case Regex.run(@cm_format, String.trim(string), capture: :all_but_first) do
      [sign, whole] -> {:ok, apply_sign(sign, String.to_integer(whole) * 10)}
      [sign, whole, tenth] -> {:ok, apply_sign(sign, String.to_integer(whole <> tenth))}
      nil -> :error
    end
  end

  defp apply_sign("-", mm), do: -mm
  defp apply_sign(_sign, mm), do: mm

  @doc """
  Formats integer millimetres as centimetres with exactly one decimal, using the locale's
  decimal separator. The unit is not included.

      iex> ToileWeb.Centimeters.format(725)
      "72.5"

      iex> ToileWeb.Centimeters.format(720)
      "72.0"
  """
  @spec format(integer()) :: String.t()
  def format(mm) when is_integer(mm) do
    sign = if mm < 0, do: "-", else: ""
    abs_mm = abs(mm)

    sign <>
      Integer.to_string(div(abs_mm, 10)) <>
      pgettext("decimal separator", ".") <> Integer.to_string(rem(abs_mm, 10))
  end

  @doc """
  Converts the centimetre values in measurement form params to millimetres.

  Only the string keys of `Toile.Measurements.Catalog` are touched; params keys are never
  converted to atoms and other keys are left as they are. A parseable value becomes integer
  millimetres. Blank and unparseable values are left unchanged, so a blank value clears the
  measurement and an unparseable one fails the schema's integer cast (with the format error)
  while the form keeps what the user typed.

      iex> ToileWeb.Centimeters.to_mm_params(%{"waist" => "72,5", "hip" => "", "neck" => "abc"})
      %{"waist" => 725, "hip" => "", "neck" => "abc"}
  """
  @spec to_mm_params(map()) :: map()
  def to_mm_params(params) when is_map(params) do
    Map.new(params, fn
      {key, value} when key in @catalog_keys and is_binary(value) -> {key, to_mm(value)}
      pair -> pair
    end)
  end

  defp to_mm(value) do
    case parse(value) do
      {:ok, mm} -> mm
      :error -> value
    end
  end

  @doc """
  Returns the value to show in a centimetre input.

  Millimetres are formatted with `format/1`; a string (what the user typed, kept after a
  failed validation) is shown as is; `nil` (missing) is the empty string.

      iex> ToileWeb.Centimeters.input_value(725)
      "72.5"

      iex> ToileWeb.Centimeters.input_value("72.55")
      "72.55"

      iex> ToileWeb.Centimeters.input_value(nil)
      ""
  """
  @spec input_value(integer() | String.t() | nil) :: String.t()
  def input_value(mm) when is_integer(mm), do: format(mm)
  def input_value(value) when is_binary(value), do: value
  def input_value(nil), do: ""
end
