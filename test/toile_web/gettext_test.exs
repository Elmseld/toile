defmodule ToileWeb.GettextTest do
  # Guards the translation files: the UI is Swedish, so every message the
  # code can show must have a Swedish translation.
  use ExUnit.Case, async: true

  alias Expo.Message

  @gettext_dir Path.expand("../../priv/gettext", __DIR__)
  @sv_dir Path.join(@gettext_dir, "sv/LC_MESSAGES")

  test "sv is the default locale" do
    assert Gettext.get_locale(ToileWeb.Gettext) == "sv"
  end

  test "every sv message is translated" do
    files = Path.wildcard(Path.join(@sv_dir, "*.po"))

    names = Enum.map(files, &Path.basename/1)
    assert "default.po" in names
    assert "errors.po" in names

    for file <- files do
      untranslated =
        file
        |> Expo.PO.parse_file!()
        |> Map.fetch!(:messages)
        |> Enum.filter(&(untranslated?(&1) or Message.has_flag?(&1, "fuzzy")))
        |> Enum.map(&Message.key/1)

      assert untranslated == [],
             "#{Path.relative_to_cwd(file)} has untranslated or fuzzy messages: " <>
               inspect(untranslated)
    end
  end

  test "every msgid in the templates is in the sv files" do
    pots = Path.wildcard(Path.join(@gettext_dir, "*.pot"))
    assert pots != []

    for pot <- pots do
      po = Path.join(@sv_dir, Path.basename(pot, ".pot") <> ".po")
      assert File.exists?(po), "#{Path.relative_to_cwd(po)} is missing"

      po_keys = po |> Expo.PO.parse_file!() |> message_keys()

      missing =
        pot
        |> Expo.PO.parse_file!()
        |> message_keys()
        |> MapSet.difference(po_keys)
        |> MapSet.to_list()

      assert missing == [],
             "#{Path.relative_to_cwd(po)} lacks msgids from #{Path.basename(pot)}, " <>
               "run `mix gettext.extract --merge`: " <> inspect(missing)
    end
  end

  defp untranslated?(%Message.Singular{msgstr: msgstr}), do: blank?(msgstr)

  defp untranslated?(%Message.Plural{msgstr: msgstr}) do
    not (Map.has_key?(msgstr, 0) and Map.has_key?(msgstr, 1)) or
      Enum.any?(Map.values(msgstr), &blank?/1)
  end

  defp blank?(iodata), do: IO.iodata_to_binary(iodata) == ""

  defp message_keys(%Expo.Messages{messages: messages}),
    do: MapSet.new(messages, &Message.key/1)
end
