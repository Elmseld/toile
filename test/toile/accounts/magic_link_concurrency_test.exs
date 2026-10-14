defmodule Toile.Accounts.MagicLinkConcurrencyTest do
  # Runs against real, committed transactions outside the SQL sandbox, because
  # concurrent requests can only race when they use separate connections.
  use ExUnit.Case, async: false

  import Ecto.Query, only: [where: 3]
  import Toile.AccountsFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias Toile.Accounts
  alias Toile.Accounts.User
  alias Toile.Repo

  @concurrent_requests 4
  # Lock-order bugs only show up when the requests interleave in a particular
  # way, so each race is repeated a few times.
  @rounds 5

  test "only one of several concurrent requests can use a magic link" do
    for _ <- 1..@rounds do
      user = unboxed_user(&unconfirmed_user_fixture/0)
      {encoded_token, _} = unboxed(fn -> generate_user_magic_link_token(user) end)

      results =
        race(
          List.duplicate(
            fn -> Accounts.login_user_by_magic_link(encoded_token) end,
            @concurrent_requests
          )
        )

      assert [{:ok, {%User{confirmed_at: %DateTime{}}, _expired}}] =
               Enum.filter(results, &match?({:ok, _}, &1))

      assert Enum.count(results, &(&1 == {:error, :not_found})) == @concurrent_requests - 1
    end
  end

  test "only one of several concurrent requests with different links confirms the user" do
    for _ <- 1..@rounds do
      user = unboxed_user(&unconfirmed_user_fixture/0)

      tokens =
        unboxed(fn ->
          for _ <- 1..@concurrent_requests do
            {encoded_token, _} = generate_user_magic_link_token(user)
            encoded_token
          end
        end)

      results =
        race(Enum.map(tokens, fn token -> fn -> Accounts.login_user_by_magic_link(token) end end))

      # Confirming the user deletes all their tokens, so the other links stop working.
      assert [{:ok, {%User{confirmed_at: %DateTime{}}, _expired}}] =
               Enum.filter(results, &match?({:ok, _}, &1))

      assert Enum.count(results, &(&1 == {:error, :not_found})) == @concurrent_requests - 1
    end
  end

  test "magic link logins and password updates for the same user do not deadlock" do
    for _ <- 1..@rounds do
      user = unboxed_user(fn -> user_fixture() |> set_password() end)

      tokens =
        unboxed(fn ->
          for _ <- 1..@concurrent_requests do
            {encoded_token, _} = generate_user_magic_link_token(user)
            encoded_token
          end
        end)

      logins =
        Enum.map(tokens, fn token ->
          {:login, fn -> Accounts.login_user_by_magic_link(token) end}
        end)

      password_updates =
        List.duplicate(
          {:password,
           fn -> Accounts.update_user_password(user, %{password: valid_user_password()}) end},
          @concurrent_requests
        )

      # Interleave the two kinds so they start as close together as possible.
      tagged = Enum.zip_with(logins, password_updates, &[&1, &2]) |> Enum.concat()
      results = Enum.zip(Enum.map(tagged, &elem(&1, 0)), race(Enum.map(tagged, &elem(&1, 1))))

      user_id = user.id

      # A login either wins its token or finds it deleted by a password update.
      for {:login, result} <- results do
        assert match?({:ok, {%User{id: ^user_id}, []}}, result) or
                 result == {:error, :not_found}
      end

      for {:password, result} <- results do
        assert {:ok, {%User{}, _expired}} = result
      end
    end
  end

  # Runs the functions concurrently, each on its own connection outside the
  # sandbox, and returns their results in order.
  defp race(funs) do
    funs
    |> Enum.map(fn fun -> Task.async(fn -> unboxed(fun) end) end)
    |> Task.await_many(10_000)
  end

  defp unboxed(fun), do: Sandbox.unboxed_run(Repo, fun)

  defp unboxed_user(fixture) do
    user = unboxed(fixture)

    on_exit(fn ->
      # Tokens are removed through the users_tokens foreign key cascade.
      unboxed(fn -> Repo.delete_all(where(User, [u], u.id == ^user.id)) end)
    end)

    user
  end
end
