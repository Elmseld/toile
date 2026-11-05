defmodule Toile.EmailDeliveryHelpers do
  @moduledoc """
  Test helpers for the background login-link deliveries under
  `Toile.Accounts.delivery_supervisor/0` (ADR 0010).
  """

  alias Toile.Accounts

  @doc """
  Waits until every login-link delivery started so far has finished, so that
  emails (`Swoosh.Adapters.Test` sends them to the test process via `$callers`),
  tokens and log lines are in place. Raises after `timeout` ms.

  A delivery is started before `Accounts.request_login_instructions/3` (and so
  a `render_submit/2` of the login form) returns, so it is always among the
  children seen here. In async runs this also waits for other tests'
  deliveries, which is harmless.
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

  defp running_deliveries do
    case Process.whereis(Accounts.delivery_supervisor()) do
      nil -> []
      supervisor -> Task.Supervisor.children(supervisor)
    end
  end
end
