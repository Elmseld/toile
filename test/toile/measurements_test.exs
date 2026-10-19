defmodule Toile.MeasurementsTest do
  use Toile.DataCase, async: true

  import Toile.AccountsFixtures, only: [user_scope_fixture: 0]
  import Toile.MeasurementsFixtures

  alias Toile.Measurements
  alias Toile.Measurements.Catalog
  alias Toile.Measurements.MeasurementProfile
  alias Toile.Measurements.Values

  @invalid_attrs %{name: nil}
  @range_message "must be more than 0 and at most 300 cm"
  @format_message "must be a number in cm with at most one decimal"

  describe "list_measurement_profiles/1" do
    test "returns only the scope's profiles" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      measurement_profile = measurement_profile_fixture(scope)
      other_measurement_profile = measurement_profile_fixture(other_scope)

      assert Measurements.list_measurement_profiles(scope) == [measurement_profile]
      assert Measurements.list_measurement_profiles(other_scope) == [other_measurement_profile]
    end

    test "orders the profiles by name" do
      scope = user_scope_fixture()
      measurement_profile_fixture(scope, name: "Rut")
      measurement_profile_fixture(scope, name: "Anna")
      measurement_profile_fixture(scope, name: "Maja")

      assert scope |> Measurements.list_measurement_profiles() |> Enum.map(& &1.name) ==
               ["Anna", "Maja", "Rut"]
    end
  end

  describe "get_measurement_profile!/2" do
    test "returns the scope's profile" do
      scope = user_scope_fixture()
      measurement_profile = measurement_profile_fixture(scope)

      assert Measurements.get_measurement_profile!(scope, measurement_profile.id) ==
               measurement_profile
    end

    test "raises for another user's profile" do
      measurement_profile = measurement_profile_fixture(user_scope_fixture())
      other_scope = user_scope_fixture()

      assert_raise Ecto.NoResultsError, fn ->
        Measurements.get_measurement_profile!(other_scope, measurement_profile.id)
      end
    end
  end

  describe "create_measurement_profile/2" do
    test "with only a name creates a profile with every measurement missing" do
      scope = user_scope_fixture()

      assert {:ok, %MeasurementProfile{} = measurement_profile} =
               Measurements.create_measurement_profile(scope, %{name: "Anna"})

      assert measurement_profile.name == "Anna"
      assert measurement_profile.user_id == scope.user.id
      assert %Values{} = measurement_profile.measurements
      assert Measurements.missing_measurements(measurement_profile) == Catalog.keys()
    end

    test "stores measurements as integer millimetres" do
      scope = user_scope_fixture()

      assert {:ok, measurement_profile} =
               Measurements.create_measurement_profile(scope, %{
                 "name" => "Anna",
                 "measurements" => %{"waist" => "725", "hip" => 980}
               })

      reloaded = Measurements.get_measurement_profile!(scope, measurement_profile.id)
      assert reloaded.measurements.waist == 725
      assert reloaded.measurements.hip == 980
      assert reloaded.measurements.bust == nil
    end

    test "accepts every catalogue key" do
      scope = user_scope_fixture()

      assert {:ok, measurement_profile} =
               Measurements.create_measurement_profile(scope, %{
                 name: "Anna",
                 measurements: complete_measurements()
               })

      assert Measurements.missing_measurements(measurement_profile) == []
    end

    test "drops unknown measurement keys" do
      scope = user_scope_fixture()

      assert {:ok, measurement_profile} =
               Measurements.create_measurement_profile(scope, %{
                 "name" => "Anna",
                 "measurements" => %{"evil" => 5, "waist" => 725}
               })

      %{rows: [[stored]]} =
        Repo.query!("SELECT measurements FROM measurement_profiles WHERE id = $1", [
          Ecto.UUID.dump!(measurement_profile.id)
        ])

      refute Map.has_key?(stored, "evil")
      assert stored["waist"] == 725
      # Unset values are written as null, not left out (ADR 0005).
      assert Map.has_key?(stored, "bust")
      assert stored["bust"] == nil
    end

    test "refuses a profile above the per-user limit" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      insert_profiles(scope, Measurements.max_measurement_profiles() - 1)

      assert {:ok, _} = Measurements.create_measurement_profile(scope, %{name: "Last"})

      assert {:error, %Ecto.Changeset{action: :insert} = changeset} =
               Measurements.create_measurement_profile(scope, %{name: "One too many"})

      assert %{name: ["you can have at most 100 measurement profiles"]} = errors_on(changeset)

      assert length(Measurements.list_measurement_profiles(scope)) ==
               Measurements.max_measurement_profiles()

      assert {:ok, _} = Measurements.create_measurement_profile(other_scope, %{name: "Anna"})
    end

    test "does not broadcast a refused profile" do
      scope = user_scope_fixture()
      insert_profiles(scope, Measurements.max_measurement_profiles())
      Measurements.subscribe_measurement_profiles(scope)

      assert {:error, _} = Measurements.create_measurement_profile(scope, %{name: "Anna"})
      refute_received {:created, _}
    end

    test "ignores user_id in attrs" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()

      assert {:ok, measurement_profile} =
               Measurements.create_measurement_profile(scope, %{
                 name: "Anna",
                 user_id: other_scope.user.id
               })

      assert measurement_profile.user_id == scope.user.id
    end

    test "with invalid data returns error changeset" do
      scope = user_scope_fixture()

      assert {:error, %Ecto.Changeset{}} =
               Measurements.create_measurement_profile(scope, @invalid_attrs)
    end

    test "requires a name of at most 100 characters" do
      scope = user_scope_fixture()

      assert {:error, changeset} = Measurements.create_measurement_profile(scope, %{name: ""})
      assert %{name: ["can't be blank"]} = errors_on(changeset)

      assert {:error, changeset} =
               Measurements.create_measurement_profile(scope, %{name: String.duplicate("a", 101)})

      assert %{name: ["should be at most 100 character(s)"]} = errors_on(changeset)

      assert {:ok, _} =
               Measurements.create_measurement_profile(scope, %{name: String.duplicate("a", 100)})
    end

    test "rejects values outside 1..3000 mm with the range message" do
      scope = user_scope_fixture()

      for value <- [0, -10, 3001] do
        assert {:error, changeset} =
                 Measurements.create_measurement_profile(scope, %{
                   name: "Anna",
                   measurements: %{waist: value}
                 })

        assert %{measurements: %{waist: [@range_message]}} = errors_on(changeset)
      end
    end

    test "accepts the limits 1 and 3000 mm" do
      scope = user_scope_fixture()

      assert {:ok, measurement_profile} =
               Measurements.create_measurement_profile(scope, %{
                 name: "Anna",
                 measurements: %{waist: 1, height: 3000}
               })

      assert measurement_profile.measurements.waist == 1
      assert measurement_profile.measurements.height == 3000
    end

    test "rejects values that are not integers with the format message" do
      scope = user_scope_fixture()

      for value <- ["abc", "72.5", 72.5] do
        assert {:error, changeset} =
                 Measurements.create_measurement_profile(scope, %{
                   name: "Anna",
                   measurements: %{waist: value}
                 })

        assert %{measurements: %{waist: [@format_message]}} = errors_on(changeset)
      end
    end
  end

  describe "update_measurement_profile/3" do
    test "with valid data updates the profile" do
      scope = user_scope_fixture()
      measurement_profile = measurement_profile_fixture(scope, measurements: %{waist: 725})

      assert {:ok, %MeasurementProfile{} = measurement_profile} =
               Measurements.update_measurement_profile(scope, measurement_profile, %{
                 "name" => "some updated name",
                 "measurements" => %{"hip" => "980"}
               })

      assert measurement_profile.name == "some updated name"
      assert measurement_profile.measurements.waist == 725
      assert measurement_profile.measurements.hip == 980
    end

    test "clearing a value removes that measurement" do
      scope = user_scope_fixture()
      measurement_profile = measurement_profile_fixture(scope, measurements: %{waist: 725})

      assert {:ok, measurement_profile} =
               Measurements.update_measurement_profile(scope, measurement_profile, %{
                 "measurements" => %{"waist" => ""}
               })

      assert :waist in Measurements.missing_measurements(measurement_profile)

      reloaded = Measurements.get_measurement_profile!(scope, measurement_profile.id)
      assert reloaded.measurements.waist == nil
    end

    test "with invalid scope raises" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      measurement_profile = measurement_profile_fixture(scope)

      assert_raise MatchError, fn ->
        Measurements.update_measurement_profile(other_scope, measurement_profile, %{})
      end
    end

    test "with invalid data returns error changeset" do
      scope = user_scope_fixture()
      measurement_profile = measurement_profile_fixture(scope)

      assert {:error, %Ecto.Changeset{}} =
               Measurements.update_measurement_profile(scope, measurement_profile, @invalid_attrs)

      assert measurement_profile ==
               Measurements.get_measurement_profile!(scope, measurement_profile.id)
    end
  end

  describe "delete_measurement_profile/2" do
    test "deletes the profile" do
      scope = user_scope_fixture()
      measurement_profile = measurement_profile_fixture(scope)

      assert {:ok, %MeasurementProfile{}} =
               Measurements.delete_measurement_profile(scope, measurement_profile)

      assert_raise Ecto.NoResultsError, fn ->
        Measurements.get_measurement_profile!(scope, measurement_profile.id)
      end
    end

    test "with invalid scope raises" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      measurement_profile = measurement_profile_fixture(scope)

      assert_raise MatchError, fn ->
        Measurements.delete_measurement_profile(other_scope, measurement_profile)
      end

      assert Measurements.get_measurement_profile!(scope, measurement_profile.id)
    end
  end

  describe "change_measurement_profile/3" do
    test "returns a profile changeset" do
      scope = user_scope_fixture()
      measurement_profile = measurement_profile_fixture(scope)

      assert %Ecto.Changeset{} =
               Measurements.change_measurement_profile(scope, measurement_profile)
    end

    test "with invalid scope raises" do
      measurement_profile = measurement_profile_fixture(user_scope_fixture())

      assert_raise MatchError, fn ->
        Measurements.change_measurement_profile(user_scope_fixture(), measurement_profile)
      end
    end
  end

  describe "subscribe_measurement_profiles/1" do
    test "broadcasts changes only to the owner's topic" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      Measurements.subscribe_measurement_profiles(scope)

      {:ok, measurement_profile} = Measurements.create_measurement_profile(scope, %{name: "A"})
      assert_receive {:created, ^measurement_profile}

      {:ok, _} = Measurements.create_measurement_profile(other_scope, %{name: "B"})
      refute_receive {:created, %MeasurementProfile{name: "B"}}
    end
  end

  describe "keys/0" do
    test "returns the catalogue keys in display order" do
      assert Measurements.keys() == Catalog.keys()
    end
  end

  describe "missing_measurements/1" do
    test "lists the keys without a value in catalogue order" do
      scope = user_scope_fixture()
      measurement_profile = measurement_profile_fixture(scope, measurements: %{waist: 725})

      assert Measurements.missing_measurements(measurement_profile) ==
               List.delete(Catalog.keys(), :waist)

      assert length(Measurements.missing_measurements(measurement_profile)) == 17
    end
  end

  describe "measurement_values/1" do
    test "maps string keys to millimetres and drops missing values" do
      scope = user_scope_fixture()

      measurement_profile =
        measurement_profile_fixture(scope, measurements: %{waist: 725, hip: 980})

      assert Measurements.measurement_values(measurement_profile) == %{
               "waist" => 725,
               "hip" => 980
             }
    end

    test "is empty for a profile without measurements" do
      measurement_profile = measurement_profile_fixture(user_scope_fixture())

      assert Measurements.measurement_values(measurement_profile) == %{}
    end

    test "has every catalogue key for a complete profile" do
      measurement_profile =
        measurement_profile_fixture(user_scope_fixture(), measurements: complete_measurements())

      values = Measurements.measurement_values(measurement_profile)

      assert Map.keys(values) |> Enum.sort() ==
               Catalog.keys() |> Enum.map(&Atom.to_string/1) |> Enum.sort()

      assert Enum.all?(Map.values(values), &(&1 == 500))
    end
  end

  # Inserts profiles directly so the limit tests do not run a hundred transactions.
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
end
