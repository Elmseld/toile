defmodule Toile.EmailDeliveryHelpers do
  @moduledoc """
  Test helpers for the background login-link deliveries under
  `Toile.Accounts.delivery_supervisor/0` (ADR 0010): waiting for them, and
  making the supervisor unavailable or full to test how a delivery that cannot
  start is handled.
  """

  import ExUnit.Callbacks, only: [on_exit: 1]

  alias Toile.Accounts

  @doc """
  Waits until every login-link delivery started so far has finished, so that
  emails (`Swoosh.Adapters.Test` sends them to the test process via `$callers`),
  tokens and log lines are in place. Raises after `timeout` ms.

  A delivery is started before `Accounts.request_login_instructions/3` (and so
  a `render_submit/2` of the login form) returns, so it is always among the
  children seen here. In async runs this also waits for other tests'
  deliveries, which is harmless. Returns at once while the supervisor is stopped.
  """
  def await_email_deliveries(timeout \\ 5_000) do
    deadline = System.monotonic_time(:millisecond) + timeout

    running_deliveries()
    |> Enum.map(&Process.monitor/1)
    |> Enum.each(fn ref ->
      remaining = max(deadline - System.monotonic_time(:millisecond), 0)

      receive do
        {:DOWN, ^ref, :process, _pid, _reason} -> :ok
      after
        remaining -> raise "email deliveries did not finish within #{timeout} ms"
      end
    end)
  end

  @doc """
  Drops the emails already sent to the calling test process (such as the ones
  the user fixtures send), so a later `assert_no_email_sent/0` only sees what
  the test itself caused.
  """
  def flush_emails do
    receive do
      {:email, _email} -> flush_emails()
    after
      0 -> :ok
    end
  end

  # None while the supervisor is stopped (`stop_delivery_supervisor/0`).
  defp running_deliveries do
    case Process.whereis(Accounts.delivery_supervisor()) do
      nil -> []
      supervisor -> Task.Supervisor.children(supervisor)
    end
  end

  @doc """
  Stops the delivery supervisor until the calling test exits, then restarts
  it. Only for test modules that are not async: async tests would lose their
  deliveries meanwhile.
  """
  def stop_delivery_supervisor do
    terminate_delivery_supervisor()
    :ok
  end

  @doc """
  Replaces the delivery supervisor with one that accepts no deliveries
  (`max_children: 0`) until the calling test exits, then restores the real one.
  Only for test modules that are not async.
  """
  def fill_delivery_supervisor do
    terminate_delivery_supervisor()

    {:ok, pid} = Task.Supervisor.start_link(name: Accounts.delivery_supervisor(), max_children: 0)
    # Not linked to the test, so it outlives the test process until the
    # on_exit callback below swaps the real one back in.
    Process.unlink(pid)
    on_exit(fn -> DynamicSupervisor.stop(pid) end)
    :ok
  end

  # Registered first, so it runs last (on_exit is last in, first out): any
  # stand-in is stopped before the real supervisor is restarted.
  defp terminate_delivery_supervisor do
    await_email_deliveries()
    :ok = Supervisor.terminate_child(Toile.Supervisor, Accounts.delivery_supervisor())

    on_exit(fn ->
      {:ok, _pid} = Supervisor.restart_child(Toile.Supervisor, Accounts.delivery_supervisor())
    end)
  end
end
