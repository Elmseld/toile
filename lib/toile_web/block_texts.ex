defmodule ToileWeb.BlockTexts do
  @moduledoc """
  The UI labels of the blocks in `Toile.Patterns.Blocks` and of the pieces in their
  definitions.

  Every text is a literal gettext call so `mix gettext.extract` finds it and the translation
  test covers it. `label/1` deliberately has no catch-all clause: a block file added to
  `engine/blocks/` without a label raises `FunctionClauseError`, which
  `test/toile_web/block_texts_test.exs` catches. `piece_label/1` falls back to the piece name,
  because a project's definition may gain pieces of its own (ticket 0008).

  Piece labels use the context "pattern piece": the plain msgid "Back" is the back button.
  """

  use Gettext, backend: ToileWeb.Gettext

  @doc """
  Returns the label of a block key.

      iex> ToileWeb.BlockTexts.label("straight_skirt")
      "Straight skirt"
  """
  @spec label(String.t()) :: String.t()
  def label("straight_skirt"), do: gettext("Straight skirt")

  @doc """
  Returns the label of a piece name, or the name itself for a piece without a label.

      iex> ToileWeb.BlockTexts.piece_label("back")
      "Back"

      iex> ToileWeb.BlockTexts.piece_label("pocket")
      "pocket"
  """
  @spec piece_label(String.t()) :: String.t()
  def piece_label("back"), do: pgettext("pattern piece", "Back")
  def piece_label("front"), do: pgettext("pattern piece", "Front")
  def piece_label(name) when is_binary(name), do: name
end
