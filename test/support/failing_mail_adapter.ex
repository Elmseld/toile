defmodule Toile.FailingMailAdapter do
  @moduledoc """
  A Swoosh adapter whose deliveries always fail, for tests of how a mailer
  outage is handled. Swap it in with `use_failing_mailer/0` (returns an error),
  `use_raising_mailer/0` (raises) or `use_exiting_mailer/0` (exits), in a test
  module that is not async, since the mailer config is global.
  """

  use Swoosh.Adapter

  @impl Swoosh.Adapter
  def deliver(email, config) do
    # The address in the raise and exit reasons lets tests check that it is
    # not logged.
    case config[:failure] do
      :raise -> raise "mailer crashed while sending to #{inspect(email.to)}"
      :exit -> exit({:mailer_down, email.to})
      _error -> {:error, {503, "service unavailable"}}
    end
  end

  @doc """
  Makes `Toile.Mailer` use this adapter, returning an error for every email,
  until the calling test exits.
  """
  def use_failing_mailer, do: swap_in(:error)

  @doc """
  Makes `Toile.Mailer` use this adapter, raising a `RuntimeError` that names
  the recipient for every email, until the calling test exits.
  """
  def use_raising_mailer, do: swap_in(:raise)

  @doc """
  Makes `Toile.Mailer` use this adapter, exiting with a reason that names the
  recipient for every email, until the calling test exits.
  """
  def use_exiting_mailer, do: swap_in(:exit)

  defp swap_in(failure) do
    original = Application.fetch_env!(:toile, Toile.Mailer)

    Application.put_env(
      :toile,
      Toile.Mailer,
      original |> Keyword.put(:adapter, __MODULE__) |> Keyword.put(:failure, failure)
    )

    ExUnit.Callbacks.on_exit(fn -> Application.put_env(:toile, Toile.Mailer, original) end)
    :ok
  end
end
