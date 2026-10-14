defmodule Toile.Repo do
  use Ecto.Repo,
    otp_app: :toile,
    adapter: Ecto.Adapters.Postgres
end
