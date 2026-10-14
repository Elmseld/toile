defmodule Toile.Accounts.MagicLinkConcurrencyTest do
  # Runs against real, committed transactions outside the SQL sandbox, because
  # concurrent requests can only race when they use separate connections.
  use ExUnit.Case, async: false

  import Toile.AccountsFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias Toile.Accounts
  alias Toile.Accounts.User
  alias Toile.Repo

  @concurrent_requests 4

  setup do
    user = Sandbox.unboxed_run(Repo, fn -> unconfirmed_user_fixture() end)

    on_exit(fn ->
      # Tokens are removed through the users_tokens foreign key cascade.
      Sandbox.unboxed_run(Repo, fn -> Repo.delete_all(User |> where_id(user.id)) end)
    end)

    %{user: user}
  end

  test "only one of several concurrent requests can use a magic link", %{user: user} do
    {encoded_token, _hashed_token} =
      Sandbox.unboxed_run(Repo, fn -> generate_user_magic_link_token(user) end)

    results =
      1..@concurrent_requests
      |> Enum.map(fn _ ->
        Task.async(fn ->
          Sandbox.unboxed_run(Repo, fn -> Accounts.login_user_by_magic_link(encoded_token) end)
        end)
      end)
      |> Task.await_many(10_000)

    assert [{:ok, {%User{confirmed_at: %DateTime{}}, _expired}}] =
             Enum.filter(results, &match?({:ok, _}, &1))

    assert Enum.count(results, &(&1 == {:error, :not_found})) == @concurrent_requests - 1
  end

  defp where_id(queryable, id) do
    import Ecto.Query, only: [where: 3]
    where(queryable, [u], u.id == ^id)
  end
end
