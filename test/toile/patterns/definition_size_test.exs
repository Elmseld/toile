defmodule Toile.Patterns.DefinitionSizeTest do
  use ExUnit.Case, async: true

  alias Toile.Patterns.DefinitionSize
  alias Toile.Patterns.PatternProject

  doctest DefinitionSize

  test "the schema uses the shared cap" do
    assert PatternProject.max_definition_bytes() == DefinitionSize.max_bytes()
    assert PatternProject.max_save_bytes() == DefinitionSize.max_save_bytes()
  end

  test "a save fits a LiveView websocket frame, and a stored definition fits a save" do
    {_path, _socket, opts} = List.keyfind(ToileWeb.Endpoint.__sockets__(), "/live", 0)
    max_frame_size = Keyword.fetch!(opts[:websocket], :max_frame_size)

    # The event envelope (refs, topic, event name, "definition" and "parameters" keys) is well
    # under a kilobyte; keep a wide margin.
    assert DefinitionSize.max_save_bytes() + 10_000 <= max_frame_size
    assert DefinitionSize.max_bytes() + 20_000 <= DefinitionSize.max_save_bytes()
  end

  test "save_too_large?/2 adds up the definition and the parameters" do
    half = div(DefinitionSize.max_save_bytes(), 2)
    definition = %{"s" => String.duplicate("a", half)}

    refute DefinitionSize.save_too_large?(definition, %{})
    assert DefinitionSize.save_too_large?(definition, %{"p" => String.duplicate("a", half)})
  end
end
