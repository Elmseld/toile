defmodule Toile.Accounts.SessionTokenConcurrencyTest do
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
  @rounds 5
  @new_password "a brand new password"

  test "a login waiting on a password update does not create a session afterwards" do
    user = unboxed_user(fn -> user_fixture() |> set_password() end)

    # The login has verified the old password and is about to create a session.
    authenticated =
      unboxed(fn ->
        Accounts.get_user_by_email_and_password(user.email, valid_user_password())
      end)

    assert %User{} = authenticated
    test_pid = self()

    # A password update that holds the user row lock until told to commit.
    reset =
      Task.async(fn ->
        unboxed(fn ->
          Repo.transact(fn ->
            {:ok, result} = Accounts.update_user_password(user, %{password: @new_password})
            send(test_pid, :password_updated)

            receive do
              :commit -> {:ok, result}
            end
          end)
        end)
      end)

    assert_receive :password_updated, 5_000

    login =
      Task.async(fn ->
        unboxed(fn ->
          %{rows: [[backend_pid]]} = Repo.query!("SELECT pg_backend_pid()")
          send(test_pid, {:login_backend, backend_pid})
          Accounts.generate_user_session_token(authenticated)
        end)
      end)

    assert_receive {:login_backend, backend_pid}, 5_000

    # Only let the update commit once the login is blocked on the user row, so
    # the login necessarily reads the row as the update left it.
    wait_until_waiting_on_lock(backend_pid)
    send(reset.pid, :commit)

    assert {:ok, {%User{}, _expired}} = Task.await(reset)
    assert Task.await(login) == {:error, :credentials_changed}
    assert session_tokens(user) == []
  end

  test "no session from a login with the old password survives concurrent password updates" do
    for _ <- 1..@rounds do
      user = unboxed_user(fn -> user_fixture() |> set_password() end)

      login = fn ->
        if authenticated =
             Accounts.get_user_by_email_and_password(user.email, valid_user_password()) do
          Accounts.generate_user_session_token(authenticated)
        else
          :wrong_password
        end
      end

      reset = fn -> Accounts.update_user_password(user, %{password: @new_password}) end

      funs =
        Enum.zip_with(
          List.duplicate(login, @concurrent_requests),
          List.duplicate(reset, @concurrent_requests),
          &[&1, &2]
        )
        |> Enum.concat()

      race(funs)

      # A session can only come from the old password, so it was created before
      # some password update committed and must have been revoked by it.
      assert session_tokens(user) == []
    end
  end

  defp wait_until_waiting_on_lock(backend_pid, attempts \\ 500) do
    %{rows: rows} =
      unboxed(fn ->
        Repo.query!("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [backend_pid])
      end)

    cond do
      rows == [["Lock"]] ->
        :ok

      attempts == 0 ->
        flunk("the login never waited on the user row lock")

      true ->
        Process.sleep(10)
        wait_until_waiting_on_lock(backend_pid, attempts - 1)
    end
  end

  defp session_tokens(user) do
    unboxed(fn -> Repo.all_by(UserToken, user_id: user.id, context: "session") end)
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
