defmodule Toile.PatternsLogTest do
  # Not async: raising the log level of `Toile.Patterns` is global, so no other test may log
  # through it meanwhile.
  use Toile.DataCase, async: false

  import ExUnit.CaptureLog
  import Toile.AccountsFixtures, only: [user_scope_fixture: 0]
  import Toile.PatternsFixtures

  alias Toile.Patterns

  setup do
    # The test config logs warnings and up; the rejection is an info line.
    Logger.put_module_level(Patterns, :info)
    on_exit(fn -> Logger.delete_module_level(Patterns) end)
  end

  test "update_pattern_edits/3 logs a rejected save with the failing fields and path, not values" do
    scope = user_scope_fixture()
    pattern_project = pattern_project_fixture(scope)
    definition = put_in(pattern_project.definition, ["points", Access.at(0), "name"], "secret")

    log =
      capture_log([level: :info], fn ->
        assert {:error, _changeset} =
                 Patterns.update_pattern_edits(scope, pattern_project, %{
                   "definition" => definition,
                   "parameters" => %{"not_declared" => 1}
                 })
      end)

    assert log =~ "Rejected pattern edit for project #{pattern_project.id}"
    assert log =~ ~s(definition at "/points/0/name")
    assert log =~ "parameters"
    refute log =~ "secret"
    refute log =~ "not_declared"
  end

  test "update_pattern_edits/3 escapes control characters of a client-chosen key in the path" do
    scope = user_scope_fixture()
    pattern_project = pattern_project_fixture(scope)
    forged = "x\n[info] Rejected pattern edit for project forged"
    definition = Map.put(pattern_project.definition, forged, 1)

    log =
      capture_log([level: :info], fn ->
        assert {:error, _changeset} =
                 Patterns.update_pattern_edits(scope, pattern_project, %{
                   "definition" => definition,
                   "parameters" => %{}
                 })
      end)

    assert log =~ ~S(definition at "/x\n[info] Rejected pattern edit for project forged")
    refute log =~ "\n[info] Rejected pattern edit for project forged"
  end
end
