defmodule ToileWeb.ParameterTexts do
  @moduledoc """
  The UI label, display unit and display order of the parameters in the block definitions, for
  the parameter panel of the pattern editor (`docs/adr/0008-pattern-editor.md`).

  Only the unit's name is decided here. Converting and formatting values in the display unit is
  the engine's job (`engine/src/editor/units.ts`), so the server renders stored values raw and
  the editor in the browser formats them.

  Every label is a literal gettext call so `mix gettext.extract` finds it and the translation
  test covers it. Unlike `ToileWeb.BlockTexts.label/1`, `label/1` falls back to the parameter
  name: a project keeps its own copy of a definition, which may hold parameters no block has
  today. `test/toile_web/parameter_texts_test.exs` checks that every parameter of every block has
  a label of its own and a unit.
  """

  use Gettext, backend: ToileWeb.Gettext

  @typedoc """
  How a parameter is shown: lengths in cm (stored mm), angles in degrees, an angle per length in
  degrees per cm (stored degrees per mm), or a plain number. The engine's `ParameterUnit`.
  """
  @type unit :: :length | :angle | :angle_per_length | :number

  # The display unit of every parameter the blocks declare; any other name is a plain number.
  @units %{
    "ease_bust" => :length,
    "ease_waist" => :length,
    "ease_hip" => :length,
    "ease_back_width" => :length,
    "ease_armhole_depth" => :length,
    "length_adjustment" => :length,
    "side_shift" => :length,
    "side_rise" => :length,
    "back_neck_rise" => :length,
    "front_neck_extra" => :length,
    "back_shoulder_drop" => :length,
    "front_shoulder_drop" => :length,
    "back_dart_length" => :length,
    "front_dart_length" => :length,
    "back_shoulder_dart" => :length,
    "back_shoulder_dart_length" => :length,
    "back_waist_dart_gap" => :length,
    "front_waist_dart_gap" => :length,
    "bust_dart_rate" => :angle_per_length,
    "bust_dart_offset" => :length,
    "max_bust_dart_angle" => :angle
  }

  # Ease first, then lengths, then the dart constants.
  @order ~w(ease_bust ease_waist ease_hip ease_back_width ease_armhole_depth length_adjustment
            side_shift side_rise back_neck_rise front_neck_extra back_shoulder_drop
            front_shoulder_drop back_dart_length front_dart_length back_shoulder_dart
            back_shoulder_dart_length back_waist_dart_gap front_waist_dart_gap bust_dart_rate
            bust_dart_offset max_bust_dart_angle)

  @positions @order |> Enum.with_index() |> Map.new()

  @doc """
  Returns the label of a parameter name, or the name itself for a parameter without a label.

      iex> ToileWeb.ParameterTexts.label("ease_hip")
      "Ease at the hip"

      iex> ToileWeb.ParameterTexts.label("pocket_depth")
      "pocket_depth"
  """
  @spec label(String.t()) :: String.t()
  def label("ease_bust"), do: gettext("Ease at the bust")
  def label("ease_waist"), do: gettext("Ease at the waist")
  def label("ease_hip"), do: gettext("Ease at the hip")
  def label("ease_back_width"), do: gettext("Ease across the back")
  def label("ease_armhole_depth"), do: gettext("Extra armhole depth")
  def label("length_adjustment"), do: gettext("Lengthen or shorten")
  def label("side_shift"), do: gettext("Move the side seam")
  def label("side_rise"), do: gettext("Raise the waist at the side")
  def label("back_dart_length"), do: gettext("Back dart length")
  def label("front_dart_length"), do: gettext("Front dart length")
  def label("back_neck_rise"), do: gettext("Raise the back neckline")
  def label("front_neck_extra"), do: gettext("Extra depth of the front neckline")
  def label("back_shoulder_drop"), do: gettext("Shoulder slope, back")
  def label("front_shoulder_drop"), do: gettext("Shoulder slope, front")
  def label("back_shoulder_dart"), do: gettext("Back shoulder dart, width")
  def label("back_shoulder_dart_length"), do: gettext("Back shoulder dart, length")

  def label("back_waist_dart_gap"),
    do: gettext("Back waist dart, distance below the underarm level")

  def label("front_waist_dart_gap"),
    do: gettext("Front waist dart, distance below the bust point")

  def label("bust_dart_rate"), do: gettext("Bust dart growth")
  def label("bust_dart_offset"), do: gettext("Bust excess without a bust dart")
  def label("max_bust_dart_angle"), do: gettext("Largest bust dart")
  def label(name) when is_binary(name), do: name

  @doc """
  Returns how a parameter is shown. Unknown names are plain numbers.

      iex> ToileWeb.ParameterTexts.unit("ease_hip")
      :length

      iex> ToileWeb.ParameterTexts.unit("bust_dart_rate")
      :angle_per_length

      iex> ToileWeb.ParameterTexts.unit("pocket_depth")
      :number
  """
  @spec unit(String.t()) :: unit()
  def unit(name) when is_binary(name), do: Map.get(@units, name, :number)

  @doc """
  Returns the unit text shown after a value in `unit`; empty for a plain number.

      iex> ToileWeb.ParameterTexts.unit_label(:length)
      "cm"
  """
  @spec unit_label(unit()) :: String.t()
  def unit_label(:length), do: gettext("cm")
  def unit_label(:angle), do: gettext("degrees")
  def unit_label(:angle_per_length), do: gettext("degrees per cm")
  def unit_label(:number), do: ""

  @doc """
  Sorts parameter names in display order: ease first, then lengths, then the dart constants, and
  names without a place last, alphabetically. Needed because the stored jsonb object has lost
  the order of the block file.

      iex> ToileWeb.ParameterTexts.sort(["side_rise", "zeta", "ease_hip", "alpha"])
      ["ease_hip", "side_rise", "alpha", "zeta"]
  """
  @spec sort([String.t()]) :: [String.t()]
  def sort(names) when is_list(names) do
    Enum.sort_by(names, &{Map.get(@positions, &1, map_size(@positions)), &1})
  end
end
