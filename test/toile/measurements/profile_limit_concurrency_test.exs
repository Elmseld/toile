defmodule Toile.Measurements.ProfileLimitConcurrencyTest do
  # Runs against real, committed transactions outside the SQL sandbox, because
  # concurrent requests can only race when they use separate connections.
  use ExUnit.Case, async: false

  import Ecto.Query, only: [where: 3]
  import Toile.AccountsFixtures, only: [user_scope_fixture: 0]

  alias Ecto.Adapters.SQL.Sandbox
  alias Toile.Accounts.User
  alias Toile.Measurements
  alias Toile.Measurements.{MeasurementProfile, Values}
  alias Toile.Repo

  @free_slots 2
  @concurrent_requests 6
  # Races only show up when the requests interleave in a particular way, so
  # the race is repeated a few times.
  @rounds 5

  test "concurrent creates for one user never overshoot the profile limit" do
    for _ <- 1..@rounds do
      scope = unboxed(&user_scope_fixture/0)
      user_id = scope.user.id
      # Profiles go with the user (`on_delete: :delete_all`).
      on_exit(fn -> unboxed(fn -> Repo.delete_all(where(User, [u], u.id == ^user_id)) end) end)

      unboxed(fn ->
        insert_profiles(scope, Measurements.max_measurement_profiles() - @free_slots)
      end)

      results =
        1..@concurrent_requests
        |> Enum.map(fn i ->
          Task.async(fn ->
            unboxed(fn ->
              Measurements.create_measurement_profile(scope, %{name: "Race #{i}"})
            end)
          end)
        end)
        |> Task.await_many(10_000)

      assert Enum.count(results, &match?({:ok, %MeasurementProfile{}}, &1)) == @free_slots

      assert Enum.count(results, &match?({:error, %Ecto.Changeset{}}, &1)) ==
               @concurrent_requests - @free_slots

      unboxed(fn ->
        assert Repo.aggregate(where(MeasurementProfile, [p], p.user_id == ^user_id), :count) ==
                 Measurements.max_measurement_profiles()
      end)
    end
  end

  defp insert_profiles(scope, count) do
    now = DateTime.utc_now(:second)

    rows =
      for i <- 1..count//1 do
        %{
          name: "Profile #{i}",
          measurements: %Values{},
          user_id: scope.user.id,
          inserted_at: now,
          updated_at: now
        }
      end

    Repo.insert_all(MeasurementProfile, rows)
  end

  defp unboxed(fun), do: Sandbox.unboxed_run(Repo, fun)
end
