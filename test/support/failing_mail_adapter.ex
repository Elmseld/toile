defmodule Toile.FailingMailAdapter do
  @moduledoc """
  A Swoosh adapter whose deliveries always fail, for tests of how a mailer
  outage is handled. Swap it in with `use_failing_mailer/0`, in a test module
  that is not async, since the mailer config is global.
  """

  use Swoosh.Adapter

  @impl Swoosh.Adapter
  def deliver(_email, _config), do: {:error, {503, "service unavailable"}}

  @doc """
  Makes `Toile.Mailer` use this adapter until the calling test exits.
  """
  def use_failing_mailer do
    original = Application.fetch_env!(:toile, Toile.Mailer)
    Application.put_env(:toile, Toile.Mailer, Keyword.put(original, :adapter, __MODULE__))
    ExUnit.Callbacks.on_exit(fn -> Application.put_env(:toile, Toile.Mailer, original) end)
    :ok
  end
end
