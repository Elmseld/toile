defmodule Toile.Patterns.ProjectLimitConcurrencyTest do
  # Runs against real, committed transactions outside the SQL sandbox, because
  # concurrent requests can only race when they use separate connections.
  use ExUnit.Case, async: false

  import Ecto.Query, only: [where: 3]
  import Toile.AccountsFixtures, only: [user_scope_fixture: 0]
  import Toile.MeasurementsFixtures, only: [measurement_profile_fixture: 1]

  alias Ecto.Adapters.SQL.Sandbox
  alias Toile.Accounts.User
  alias Toile.Patterns
  alias Toile.Patterns.{Blocks, PatternProject}
  alias Toile.Repo

  @free_slots 2
  @concurrent_requests 6
  @rounds 5

  test "concurrent creates for one user never overshoot the project limit" do
    for _ <- 1..@rounds do
      scope = unboxed(&user_scope_fixture/0)
      user_id = scope.user.id
      # Profiles and projects go with the user (`on_delete: :delete_all`).
      on_exit(fn -> unboxed(fn -> Repo.delete_all(where(User, [u], u.id == ^user_id)) end) end)

      profile = unboxed(fn -> measurement_profile_fixture(scope) end)

      unboxed(fn ->
        insert_projects(scope, profile, Patterns.max_pattern_projects() - @free_slots)
      end)

      results =
        1..@concurrent_requests
        |> Enum.map(fn i ->
          Task.async(fn ->
            unboxed(fn ->
              Patterns.create_pattern_project(scope, %{
                name: "Race #{i}",
                block: "straight_skirt",
                measurement_profile_id: profile.id
              })
            end)
          end)
        end)
        |> Task.await_many(10_000)

      assert Enum.count(results, &match?({:ok, %PatternProject{}}, &1)) == @free_slots

      assert Enum.count(results, &match?({:error, %Ecto.Changeset{}}, &1)) ==
               @concurrent_requests - @free_slots

      unboxed(fn ->
        assert Repo.aggregate(where(PatternProject, [p], p.user_id == ^user_id), :count) ==
                 Patterns.max_pattern_projects()
      end)
    end
  end

  defp insert_projects(scope, profile, count) do
    now = DateTime.utc_now(:second)

    rows =
      for i <- 1..count//1 do
        %{
          name: "Project #{i}",
          block: "straight_skirt",
          definition: Blocks.definition("straight_skirt"),
          parameters: %{},
          user_id: scope.user.id,
          measurement_profile_id: profile.id,
          inserted_at: now,
          updated_at: now
        }
      end

    Repo.insert_all(PatternProject, rows)
  end

  defp unboxed(fun), do: Sandbox.unboxed_run(Repo, fun)
end
