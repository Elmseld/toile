defmodule ToileWeb.MeasurementTexts do
  @moduledoc """
  The UI label and help text of each measurement key in `Toile.Measurements.keys/0`.

  Every text is a literal `gettext/1` call so `mix gettext.extract` finds it and the
  translation test covers it. There is deliberately no catch-all clause: a key added to
  `engine/src/measurements.json` without texts raises `FunctionClauseError`, which
  `test/toile_web/measurement_texts_test.exs` catches.
  """

  use Gettext, backend: ToileWeb.Gettext

  @doc """
  Returns the label of a measurement key, without unit.

      iex> ToileWeb.MeasurementTexts.label(:waist)
      "Waist circumference"
  """
  @spec label(atom()) :: String.t()
  def label(:bust), do: gettext("Bust circumference")
  def label(:waist), do: gettext("Waist circumference")
  def label(:hip), do: gettext("Hip circumference")
  def label(:neck), do: gettext("Neck circumference")
  def label(:shoulder_width), do: gettext("Shoulder width")
  def label(:back_width), do: gettext("Back width")
  def label(:chest_width), do: gettext("Chest width")
  def label(:back_length), do: gettext("Back length")
  def label(:armhole_depth), do: gettext("Nape to underarm level")
  def label(:front_length), do: gettext("Front length")
  def label(:bust_height), do: gettext("Bust height")
  def label(:bust_distance), do: gettext("Bust point distance")
  def label(:hip_height), do: gettext("Hip height")
  def label(:skirt_length), do: gettext("Skirt length")
  def label(:arm_length), do: gettext("Arm length")
  def label(:upper_arm), do: gettext("Upper arm circumference")
  def label(:wrist), do: gettext("Wrist circumference")
  def label(:height), do: gettext("Height")

  @doc """
  Returns the help text of a measurement key: where and how to take the measurement.
  """
  @spec help(atom()) :: String.t()
  def help(:bust),
    do: gettext("Around the fullest part of the bust, with the tape level across the back.")

  def help(:waist),
    do:
      gettext(
        "Around the natural waist, the narrowest part of the torso. Tie a band there to mark it for the other measurements."
      )

  def help(:hip),
    do: gettext("Around the fullest part of the hips and seat, with the tape level.")

  def help(:neck),
    do: gettext("Around the base of the neck, over the prominent bone at the back of the neck.")

  def help(:shoulder_width),
    do: gettext("Along one shoulder, from the side of the neck to the shoulder point.")

  def help(:back_width),
    do: gettext("Across the back between the armhole creases, about 10 cm below the neck bone.")

  def help(:chest_width),
    do: gettext("Across the front between the armhole creases, above the bust.")

  def help(:back_length),
    do: gettext("From the prominent neck bone straight down the spine to the waist.")

  def help(:armhole_depth),
    do:
      gettext(
        "Tie a band around the upper body, level and as high up under the arms as it goes. Measure from the neck bone straight down the spine to the band."
      )

  def help(:front_length),
    do:
      gettext(
        "From the side of the neck at the shoulder, over the bust point, down to the waist."
      )

  def help(:bust_height),
    do: gettext("From the side of the neck at the shoulder down to the bust point.")

  def help(:bust_distance),
    do: gettext("Straight across between the two bust points.")

  def help(:hip_height),
    do: gettext("At the side, from the waist down to the fullest part of the hips.")

  def help(:skirt_length),
    do: gettext("At the side, from the waist down to the desired hem.")

  def help(:arm_length),
    do:
      gettext(
        "With the arm slightly bent, from the shoulder point over the elbow to the wrist bone."
      )

  def help(:upper_arm),
    do: gettext("Around the fullest part of the upper arm, with the arm relaxed.")

  def help(:wrist),
    do: gettext("Around the wrist, over the wrist bone.")

  def help(:height),
    do: gettext("Standing straight without shoes, from the top of the head to the floor.")
end
