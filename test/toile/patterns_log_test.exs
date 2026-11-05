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

  test "update_pattern_edits/4 logs a rejected save with the failing fields and path, not values" do
    scope = user_scope_fixture()
    pattern_project = pattern_project_fixture(scope)
    definition = put_in(pattern_project.definition, ["points", Access.at(0), "name"], "secret")

    log =
      capture_log([level: :info], fn ->
        assert {:error, _changeset} =
                 Patterns.update_pattern_edits(scope, pattern_project, pattern_project.block, %{
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

  test "update_pattern_edits/4 escapes control characters of a client-chosen key in the path" do
    scope = user_scope_fixture()
    pattern_project = pattern_project_fixture(scope)
    forged = "x\n[info] Rejected pattern edit for project forged"
    definition = Map.put(pattern_project.definition, forged, 1)

    log =
      capture_log([level: :info], fn ->
        assert {:error, _changeset} =
                 Patterns.update_pattern_edits(scope, pattern_project, pattern_project.block, %{
                   "definition" => definition,
                   "parameters" => %{}
                 })
      end)

    assert log =~ ~S(definition at "/x\n[info] Rejected pattern edit for project forged")
    refute log =~ "\n[info] Rejected pattern edit for project forged"
  end

  test "update_pattern_edits/4 logs an unknown part with control characters escaped" do
    scope = user_scope_fixture()
    pattern_project = pattern_project_fixture(scope)
    forged = "collar\n[info] forged"

    log =
      capture_log([level: :info], fn ->
        assert {:error, :unknown_part} =
                 Patterns.update_pattern_edits(scope, pattern_project, forged, %{
                   "definition" => pattern_project.definition,
                   "parameters" => %{}
                 })
      end)

    assert log =~ ~S(part "collar\n[info] forged": unknown part)
    refute log =~ "\n[info] forged"
  end

  test "update_seam_allowances/3 logs a rejected save with field names, not keys or values" do
    scope = user_scope_fixture()
    pattern_project = pattern_project_fixture(scope)

    log =
      capture_log([level: :info], fn ->
        assert {:error, _changeset} =
                 Patterns.update_seam_allowances(scope, pattern_project, %{
                   "default" => 150.25,
                   "edges" => %{"secret\n[info] forged" => %{"x" => 1}}
                 })
      end)

    assert log =~
             "Rejected seam allowances for project #{pattern_project.id}: seam_allowances.default, seam_allowances.edges"

    refute log =~ "secret"
    # A dotted number, since the project id in the line can hold any run of hex digits.
    refute log =~ "150.25"
  end
end
