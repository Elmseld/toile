defmodule Toile.Accounts.EmailChangeConcurrencyTest do
  # Runs against real, committed transactions outside the SQL sandbox, because
  # concurrent requests can only race when they use separate connections.
  use ExUnit.Case, async: false

  import Ecto.Query, only: [where: 3]
  import Toile.AccountsFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias Toile.Accounts
  alias Toile.Accounts.{User, UserToken}
  alias Toile.Repo

  @concurrent_requests 4
  # Races only show up when the requests interleave in a particular way, so
  # each race is repeated a few times.
  @rounds 5

  test "only one of several concurrent email changes with different links wins" do
    for _ <- 1..@rounds do
      user = unboxed(&user_fixture/0)
      on_exit(fn -> unboxed(fn -> Repo.delete_all(where(User, [u], u.id == ^user.id)) end) end)

      links =
        unboxed(fn ->
          for _ <- 1..@concurrent_requests do
            new_email = unique_user_email()

            token =
              extract_user_token(fn url ->
                Accounts.deliver_user_update_email_instructions(
                  %{user | email: new_email},
                  user.email,
                  url
                )
              end)

            {new_email, token}
          end
        end)

      results =
        links
        |> Enum.map(fn {_email, token} ->
          Task.async(fn -> unboxed(fn -> Accounts.update_user_email(user, token) end) end)
        end)
        |> Task.await_many(10_000)

      assert [{:ok, %User{email: winner}}] = Enum.filter(results, &match?({:ok, _}, &1))
      assert winner in Enum.map(links, &elem(&1, 0))

      assert Enum.count(results, &(&1 == {:error, :transaction_aborted})) ==
               @concurrent_requests - 1

      # No revoked link overwrote the winning change.
      unboxed(fn ->
        assert Repo.get!(User, user.id).email == winner
        refute Repo.get_by(UserToken, user_id: user.id, context: "change:#{user.email}")
      end)
    end
  end

  defp unboxed(fun), do: Sandbox.unboxed_run(Repo, fun)
end
