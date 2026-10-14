defmodule Toile.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      ToileWeb.Telemetry,
      Toile.Repo,
      {DNSCluster, query: Application.get_env(:toile, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Toile.PubSub},
      # Start a worker by calling: Toile.Worker.start_link(arg)
      # {Toile.Worker, arg},
      # Start to serve requests, typically the last entry
      ToileWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Toile.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    ToileWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
