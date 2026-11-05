defmodule Toile.SlowMailAdapter do
  @moduledoc """
  A Swoosh adapter that waits before handing the email to
  `Swoosh.Adapters.Test`, for tests that check a reply does not wait on the
  mailer. Swap it in with `use_slow_mailer/1`, in a test module that is not
  async, since the mailer config is global.
  """

  use Swoosh.Adapter

  @impl Swoosh.Adapter
  def deliver(email, config) do
    Process.sleep(Keyword.fetch!(config, :delay))
    Swoosh.Adapters.Test.deliver(email, config)
  end

  @doc """
  Makes `Toile.Mailer` use this adapter, waiting `delay_ms` per email, until
  the calling test exits.
  """
  def use_slow_mailer(delay_ms) when is_integer(delay_ms) and delay_ms >= 0 do
    original = Application.fetch_env!(:toile, Toile.Mailer)

    Application.put_env(
      :toile,
      Toile.Mailer,
      original |> Keyword.put(:adapter, __MODULE__) |> Keyword.put(:delay, delay_ms)
    )

    ExUnit.Callbacks.on_exit(fn -> Application.put_env(:toile, Toile.Mailer, original) end)
    :ok
  end
end
