defmodule Toile.Tooling.CheckToolVersionsTest do
  use ExUnit.Case, async: true

  @script Path.expand("../../../bin/check-tool-versions", __DIR__)

  @tool_versions "erlang 29.1.2\nelixir 1.20.4-otp-29\nbun 1.4.3\n"
  @dockerfile """
  ARG ELIXIR_VERSION=1.20.4
  ARG OTP_VERSION=29.1.2
  ARG DEBIAN_VERSION=trixie-20261005-slim
  ARG BUN_VERSION=1.4.3
  FROM scratch
  """

  @moduletag :tmp_dir

  # The script resolves the repo root from its own location, so run a copy
  # inside a fixture tree.
  defp run(tmp_dir, tool_versions, dockerfile) do
    File.mkdir_p!(Path.join(tmp_dir, "bin"))
    script = Path.join([tmp_dir, "bin", "check-tool-versions"])
    File.cp!(@script, script)
    File.chmod!(script, 0o755)
    File.write!(Path.join(tmp_dir, ".tool-versions"), tool_versions)
    File.write!(Path.join(tmp_dir, "Dockerfile"), dockerfile)
    System.cmd("sh", [script], stderr_to_stdout: true)
  end

  test "passes when the Dockerfile matches .tool-versions", %{tmp_dir: dir} do
    assert {out, 0} = run(dir, @tool_versions, @dockerfile)
    assert out =~ "ok       erlang"
    assert out =~ "ok       elixir"
    assert out =~ "ok       bun"
    refute out =~ "MISMATCH"
  end

  test "the real repo files agree" do
    assert {out, 0} = System.cmd("sh", [@script], stderr_to_stdout: true)
    refute out =~ "MISMATCH"
  end

  test "fails on an Erlang mismatch", %{tmp_dir: dir} do
    assert {out, 1} = run(dir, String.replace(@tool_versions, "29.1.2", "29.0.5"), @dockerfile)
    assert out =~ "MISMATCH erlang"
    assert out =~ "ok       bun"
  end

  test "fails on an Elixir mismatch", %{tmp_dir: dir} do
    assert {out, 1} = run(dir, String.replace(@tool_versions, "1.20.4", "1.20.3"), @dockerfile)
    assert out =~ "MISMATCH elixir"
  end

  test "fails when the OTP major in the Elixir version differs", %{tmp_dir: dir} do
    assert {out, 1} = run(dir, String.replace(@tool_versions, "otp-29", "otp-28"), @dockerfile)
    assert out =~ "MISMATCH elixir"
  end

  test "fails on a Bun mismatch", %{tmp_dir: dir} do
    assert {out, 1} =
             run(dir, String.replace(@tool_versions, "bun 1.4.3", "bun 1.4.2"), @dockerfile)

    assert out =~ "MISMATCH bun"
  end

  test "fails when a Dockerfile ARG is missing", %{tmp_dir: dir} do
    dockerfile = String.replace(@dockerfile, "ARG BUN_VERSION=1.4.3\n", "")
    assert {out, 1} = run(dir, @tool_versions, dockerfile)
    assert out =~ "MISMATCH bun"
    assert out =~ "Dockerfile=<missing>"
  end

  test "fails when .tool-versions lacks a tool", %{tmp_dir: dir} do
    assert {out, 1} = run(dir, "erlang 29.1.2\nelixir 1.20.4-otp-29\n", @dockerfile)
    assert out =~ "MISMATCH bun"
    assert out =~ ".tool-versions=<missing>"
  end
end
