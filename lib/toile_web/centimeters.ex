defmodule ToileWeb.Centimeters do
  @moduledoc """
  Converts between the centimetres the UI shows and the integer millimetres the app stores.

  Lengths are millimetres everywhere in code and storage; only the UI shows centimetres, with
  exactly one decimal. Input accepts both `.` and `,` as decimal separator; output uses the
  separator of the current locale (`pgettext("decimal separator", ".")`, `,` in Swedish).
  Only integer arithmetic is used, never floats.
  """

  use Gettext, backend: ToileWeb.Gettext

  alias Toile.Measurements

  # An optional sign, whole centimetres and at most one decimal. The sign is accepted so the
  # range validation reports negative values; `+` is accepted because Ecto's integer cast
  # would otherwise read a passed-through "+5" as 5 mm. Leading zeros are skipped and at most
  # five significant digits are read, so `String.to_integer/1` only ever sees short strings.
  # Leading zeros must match here: a passed-through "000001" would be cast by Ecto as 1 mm.
  # A passed-through plain number with six or more significant digits is cast by Ecto as at
  # least 100000 mm, which the range validation rejects.
  @cm_format ~r/\A([-+]?)0*(\d{1,5})(?:[.,](\d))?\z/

  # Unparseable values longer than this (in characters) are truncated before they are passed
  # through, so a huge input is neither stored in the changeset nor echoed back to the form.
  @max_passthrough_length 20

  @catalog_keys Enum.map(Measurements.keys(), &Atom.to_string/1)

  @doc """
  Parses a centimetre string into integer millimetres.

  Surrounding whitespace is ignored. Anything other than a whole number with at most one
  decimal (`.` or `,`) is `:error`, as is a number with more than five significant digits
  (leading zeros do not count). The range is not checked here.

      iex> ToileWeb.Centimeters.parse("72,5")
      {:ok, 725}

      iex> ToileWeb.Centimeters.parse(" 72 ")
      {:ok, 720}

      iex> ToileWeb.Centimeters.parse("72.55")
      :error

      iex> ToileWeb.Centimeters.parse("123456")
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

  Only the string keys of `Toile.Measurements.keys/0` are touched; params keys are never
  converted to atoms and other keys are left as they are. A parseable value becomes integer
  millimetres. Blank and unparseable values are left unchanged, so a blank value clears the
  measurement and an unparseable one fails the schema's integer cast (with the format error)
  while the form keeps what the user typed. An unparseable value longer than
  #{@max_passthrough_length} characters is cut to its first #{@max_passthrough_length}
  characters followed by `…`, which still fails the integer cast.

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
      :error -> truncate(value)
    end
  end

  defp truncate(value) do
    case String.split_at(value, @max_passthrough_length) do
      {_head, ""} -> value
      {head, _rest} -> head <> "…"
    end
  end

  @doc """
  Returns the value to show in a centimetre input.

  Millimetres are formatted with `format/1`; a string (what the user typed, kept after a
  failed validation) is shown as is; `nil` (missing) and any other value (such as a list or
  map from forged params, which fails the integer cast with the format error) is the empty
  string.

      iex> ToileWeb.Centimeters.input_value(725)
      "72.5"

      iex> ToileWeb.Centimeters.input_value("72.55")
      "72.55"

      iex> ToileWeb.Centimeters.input_value(nil)
      ""

      iex> ToileWeb.Centimeters.input_value(["72"])
      ""
  """
  @spec input_value(term()) :: String.t()
  def input_value(mm) when is_integer(mm), do: format(mm)
  def input_value(value) when is_binary(value), do: value
  def input_value(nil), do: ""
  def input_value(_other), do: ""
end
