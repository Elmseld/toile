defmodule Toile.FailingMailAdapter do
  @moduledoc """
  A Swoosh adapter whose deliveries always fail, for tests of how a mailer
  outage is handled. Swap it in with `use_failing_mailer/0` (returns an error)
  or `use_raising_mailer/0` (raises), in a test module that is not async, since
  the mailer config is global.
  """

  use Swoosh.Adapter

  @impl Swoosh.Adapter
  def deliver(email, config) do
    if config[:raise] do
      # The address in the message lets tests check that it is not logged.
      raise "mailer crashed while sending to #{inspect(email.to)}"
    else
      {:error, {503, "service unavailable"}}
    end
  end

  @doc """
  Makes `Toile.Mailer` use this adapter, returning an error for every email,
  until the calling test exits.
  """
  def use_failing_mailer, do: swap_in(raise: false)

  @doc """
  Makes `Toile.Mailer` use this adapter, raising a `RuntimeError` that names
  the recipient for every email, until the calling test exits.
  """
  def use_raising_mailer, do: swap_in(raise: true)

  defp swap_in(opts) do
    original = Application.fetch_env!(:toile, Toile.Mailer)

    Application.put_env(
      :toile,
      Toile.Mailer,
      original |> Keyword.put(:adapter, __MODULE__) |> Keyword.merge(opts)
    )

    ExUnit.Callbacks.on_exit(fn -> Application.put_env(:toile, Toile.Mailer, original) end)
    :ok
  end
end
