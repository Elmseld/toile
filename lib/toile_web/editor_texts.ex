defmodule ToileWeb.EditorTexts do
  @moduledoc """
  The UI texts the pattern editor in the browser shows (`docs/adr/0008-pattern-editor.md`),
  passed to the `PatternView` hook as JSON in `data-texts` on `#pattern-canvas`.

  Every text is a literal gettext call so `mix gettext.extract` finds it and the translation test
  covers it. Texts with a placeholder keep it for the hook to fill in: the call binds it to
  itself (`gettext("... %{name} ...", name: "%{name}")`), because Gettext raises on a missing
  binding. Error texts all use `%{name}` for the name they mention (the error's `reference`,
  `function` or `dependency`, whichever applies).
  """

  use Gettext, backend: ToileWeb.Gettext

  alias ToileWeb.ParameterTexts

  @doc """
  Returns every editor text, keyed by strings so it encodes to JSON as is:

    * `"ops"`: a plain description of each point operation, by op name.
    * `"fields"`: a label for each point field, by field name.
    * `"errors"`: a text for each engine error kind the editor shows, plus `"generic"` for any
      other and `"parameter_format"` for a parameter value that is not a number.
    * `"status"`: the save status, `"saving"`, `"saved"` and `"failed"`.
    * `"offset"`: the sentence for a moved point, with `%{x}` and `%{y}` in cm;
      `"not_moved"` for a point without an offset and `"reset_offset"` for the button that
      removes it.
    * `"units"`: the unit text of each parameter unit (`ToileWeb.ParameterTexts.unit_label/1`).
    * `"decimal_separator"`: the locale's decimal separator.

  It is a function rather than a module attribute because the texts depend on the locale of the
  calling process.
  """
  @spec texts() :: map()
  def texts do
    %{
      "ops" => ops(),
      "fields" => fields(),
      "errors" => errors(),
      "status" => %{
        "saving" => gettext("Saving..."),
        "saved" => gettext("Saved"),
        "failed" => gettext("Your changes could not be saved")
      },
      "offset" => gettext("Moved %{x} cm sideways and %{y} cm up or down", x: "%{x}", y: "%{y}"),
      "not_moved" => gettext("Not moved"),
      "reset_offset" => gettext("Reset position"),
      "units" =>
        Map.new(
          [:length, :angle, :angle_per_length, :number],
          &{Atom.to_string(&1), ParameterTexts.unit_label(&1)}
        ),
      "decimal_separator" => pgettext("decimal separator", ".")
    }
  end

  defp ops do
    %{
      "start" => gettext("Start point"),
      "offset" => gettext("Offset from a point"),
      "along_line" => gettext("On a line between two points"),
      "along_angle" => gettext("At an angle from a point"),
      "perpendicular" => gettext("Squared out from a line"),
      "line_intersection" => gettext("Where two lines cross"),
      "line_circle_intersection" => gettext("Where a line meets a circle"),
      "midpoint" => gettext("Halfway between two points")
    }
  end

  defp fields do
    %{
      "x" => gettext("Position sideways (x)"),
      "y" => gettext("Position up or down (y)"),
      "dx" => gettext("To the right (dx)"),
      "dy" => gettext("Down (dy)"),
      "distance" => gettext("Distance"),
      "angle" => gettext("Angle (degrees, 0 = right, 90 = down)"),
      "radius" => gettext("Radius"),
      "from" => gettext("From point"),
      "to" => gettext("Towards point"),
      "center" => gettext("Centre point"),
      "line" => gettext("Line"),
      "line1" => gettext("First line"),
      "line2" => gettext("Second line"),
      "which" => gettext("Which crossing point")
    }
  end

  defp errors do
    %{
      "syntax" => gettext("The formula cannot be read."),
      "unknown_reference" => gettext("There is nothing called %{name}.", name: "%{name}"),
      "unknown_function" => gettext("There is no function called %{name}.", name: "%{name}"),
      "wrong_argument_count" => gettext("Wrong number of values for %{name}.", name: "%{name}"),
      "invalid_argument" => gettext("%{name} needs point names here.", name: "%{name}"),
      "division_by_zero" => gettext("The formula divides by zero."),
      "circular_dependency" => gettext("The formula depends on itself."),
      "failed_dependency" =>
        gettext("%{name} cannot be computed with this change.", name: "%{name}"),
      "wrong_reference_kind" => gettext("%{name} cannot be used here.", name: "%{name}"),
      "invalid_result" => gettext("The formula does not give a usable number."),
      "no_intersection" => gettext("The lines do not meet."),
      "degenerate_geometry" =>
        gettext("The points end up too close to each other or too far away."),
      "generic" => gettext("The pattern cannot be drawn with this change."),
      "parameter_format" => gettext("Enter a number, e.g. 4.5")
    }
  end
end
