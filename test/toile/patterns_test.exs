defmodule Toile.PatternsTest do
  use Toile.DataCase, async: true

  import Toile.AccountsFixtures, only: [user_scope_fixture: 0]
  import Toile.MeasurementsFixtures
  import Toile.PatternsFixtures

  alias Toile.Measurements
  alias Toile.Patterns
  alias Toile.Patterns.Blocks
  alias Toile.Patterns.PatternPart
  alias Toile.Patterns.PatternProject

  defp valid_attrs(scope, attrs \\ %{}) do
    profile = measurement_profile_fixture(scope, measurements: complete_measurements())

    Enum.into(attrs, %{
      name: "Summer skirt",
      block: "straight_skirt",
      measurement_profile_id: profile.id
    })
  end

  describe "list_pattern_projects/1" do
    test "returns only the scope's projects" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)
      other_pattern_project = pattern_project_fixture(other_scope)

      assert [listed] = Patterns.list_pattern_projects(scope)
      assert listed.id == pattern_project.id
      assert [other_listed] = Patterns.list_pattern_projects(other_scope)
      assert other_listed.id == other_pattern_project.id
    end

    test "orders by name" do
      scope = user_scope_fixture()

      for name <- ["Rut", "Anna", "Maja"], do: pattern_project_fixture(scope, name: name)

      assert scope |> Patterns.list_pattern_projects() |> Enum.map(& &1.name) ==
               ["Anna", "Maja", "Rut"]
    end

    test "does not load definitions, parameters or parts but preloads the profile name" do
      scope = user_scope_fixture()
      profile = measurement_profile_fixture(scope, name: "Anna")

      pattern_project =
        pattern_project_fixture(scope, name: "Skirt", measurement_profile_id: profile.id)

      {1, _} =
        Repo.update_all(
          from(p in PatternProject, where: p.id == ^pattern_project.id),
          set: [
            parameters: %{"ease_hip" => 60},
            parts: [%PatternPart{name: "x", block: "x", definition: %{}, parameters: %{}}]
          ]
        )

      assert [listed] = Patterns.list_pattern_projects(scope)
      assert listed.name == "Skirt"
      assert listed.block == "straight_skirt"
      assert listed.definition == nil
      # Not loaded: the schema default, not the stored overrides.
      assert listed.parameters == %{}
      assert listed.parts == []
      assert listed.measurement_profile_id == profile.id
      assert listed.measurement_profile.id == profile.id
      assert listed.measurement_profile.name == "Anna"
    end

    test "preloads nil when the profile was deleted" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      {:ok, _} =
        Measurements.delete_measurement_profile(scope, pattern_project.measurement_profile)

      assert [%PatternProject{measurement_profile_id: nil, measurement_profile: nil}] =
               Patterns.list_pattern_projects(scope)
    end
  end

  describe "get_pattern_project!/2" do
    test "returns the project with its definition and profile" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      fetched = Patterns.get_pattern_project!(scope, pattern_project.id)
      assert fetched == pattern_project
      assert fetched.definition == Blocks.definition("straight_skirt")
      assert fetched.measurement_profile.id == pattern_project.measurement_profile_id
    end

    test "raises for another user's project" do
      pattern_project = pattern_project_fixture(user_scope_fixture())
      other_scope = user_scope_fixture()

      assert_raise Ecto.NoResultsError, fn ->
        Patterns.get_pattern_project!(other_scope, pattern_project.id)
      end
    end

    test "returns the stored definition, not the block file" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)
      stored = %{"version" => 1, "measurements" => ["hip"], "points" => []}

      {1, _} =
        Repo.update_all(
          from(p in PatternProject, where: p.id == ^pattern_project.id),
          set: [definition: stored]
        )

      assert Patterns.get_pattern_project!(scope, pattern_project.id).definition == stored
    end
  end

  describe "pattern_project_exists?/2" do
    test "is true only for the scope's own projects" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      assert Patterns.pattern_project_exists?(scope, pattern_project.id)
      refute Patterns.pattern_project_exists?(user_scope_fixture(), pattern_project.id)
    end

    test "is false for unknown or malformed ids" do
      scope = user_scope_fixture()

      refute Patterns.pattern_project_exists?(scope, Ecto.UUID.generate())
      refute Patterns.pattern_project_exists?(scope, "not-a-uuid")
      refute Patterns.pattern_project_exists?(scope, nil)
      refute Patterns.pattern_project_exists?(scope, %{"id" => "x"})
    end
  end

  describe "create_pattern_project/2" do
    test "copies the block definition and starts with no parameters" do
      scope = user_scope_fixture()
      attrs = valid_attrs(scope)

      assert {:ok, %PatternProject{} = pattern_project} =
               Patterns.create_pattern_project(scope, attrs)

      assert pattern_project.name == "Summer skirt"
      assert pattern_project.block == "straight_skirt"
      assert pattern_project.definition == Blocks.definition("straight_skirt")
      assert pattern_project.parameters == %{}
      assert pattern_project.user_id == scope.user.id
      assert pattern_project.measurement_profile_id == attrs.measurement_profile_id
      assert pattern_project.measurement_profile.id == attrs.measurement_profile_id

      reloaded = Patterns.get_pattern_project!(scope, pattern_project.id)
      assert reloaded.definition == Blocks.definition("straight_skirt")
      assert reloaded.parameters == %{}
    end

    test "copies the bodice definition for a bodice project" do
      scope = user_scope_fixture()

      assert {:ok, %PatternProject{} = pattern_project} =
               Patterns.create_pattern_project(scope, valid_attrs(scope, %{block: "bodice"}))

      assert pattern_project.block == "bodice"
      assert pattern_project.definition == Blocks.definition("bodice")
      assert pattern_project.parameters == %{}
    end

    test "requires name, block and profile" do
      scope = user_scope_fixture()

      assert {:error, changeset} = Patterns.create_pattern_project(scope, %{})

      assert %{
               name: ["can't be blank"],
               block: ["can't be blank"],
               measurement_profile_id: ["can't be blank"]
             } = errors_on(changeset)
    end

    test "rejects an unknown block" do
      scope = user_scope_fixture()

      assert {:error, changeset} =
               Patterns.create_pattern_project(scope, valid_attrs(scope, block: "ball_gown"))

      assert %{block: ["is invalid"]} = errors_on(changeset)
      refute Ecto.Changeset.get_change(changeset, :definition)
    end

    test "rejects a block with imports, which can only be added to a project" do
      scope = user_scope_fixture()

      assert {:error, changeset} =
               Patterns.create_pattern_project(
                 scope,
                 valid_attrs(scope, block: "straight_sleeve")
               )

      assert %{block: ["is invalid"]} = errors_on(changeset)
    end

    test "requires a name of at most 100 characters" do
      scope = user_scope_fixture()
      too_long = valid_attrs(scope, name: String.duplicate("a", 101))

      assert {:error, changeset} = Patterns.create_pattern_project(scope, too_long)
      assert %{name: ["should be at most 100 character(s)"]} = errors_on(changeset)

      assert {:ok, _} =
               Patterns.create_pattern_project(
                 scope,
                 valid_attrs(scope, name: String.duplicate("a", 100))
               )
    end

    test "rejects another user's profile" do
      scope = user_scope_fixture()
      other_profile = measurement_profile_fixture(user_scope_fixture())

      assert {:error, changeset} =
               Patterns.create_pattern_project(
                 scope,
                 valid_attrs(scope, measurement_profile_id: other_profile.id)
               )

      assert %{measurement_profile_id: ["is invalid"]} = errors_on(changeset)
      assert Patterns.list_pattern_projects(scope) == []
    end

    test "rejects a profile id that does not exist or is not a UUID" do
      scope = user_scope_fixture()

      for id <- [Ecto.UUID.generate(), "not-a-uuid"] do
        assert {:error, changeset} =
                 Patterns.create_pattern_project(
                   scope,
                   valid_attrs(scope, measurement_profile_id: id)
                 )

        assert %{measurement_profile_id: ["is invalid"]} = errors_on(changeset)
      end
    end

    test "ignores user_id, definition and parameters in attrs" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()

      attrs =
        valid_attrs(scope, %{
          user_id: other_scope.user.id,
          definition: %{"version" => 1},
          parameters: %{"ease_hip" => 60}
        })

      assert {:ok, pattern_project} = Patterns.create_pattern_project(scope, attrs)
      assert pattern_project.user_id == scope.user.id
      assert pattern_project.definition == Blocks.definition("straight_skirt")
      assert pattern_project.parameters == %{}
    end

    test "allows #{Patterns.max_pattern_projects()} projects per user, then errors on name" do
      scope = user_scope_fixture()
      max = Patterns.max_pattern_projects()
      insert_projects(scope, max - 1)

      assert {:ok, _} = Patterns.create_pattern_project(scope, valid_attrs(scope))

      assert {:error, changeset} = Patterns.create_pattern_project(scope, valid_attrs(scope))
      assert %{name: ["you can have at most #{max} patterns"]} == errors_on(changeset)
      assert changeset.action == :insert

      # Another user is not affected.
      other_scope = user_scope_fixture()
      assert {:ok, _} = Patterns.create_pattern_project(other_scope, valid_attrs(other_scope))
    end
  end

  describe "update_pattern_project/3" do
    test "renames the project" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      assert {:ok, updated} =
               Patterns.update_pattern_project(scope, pattern_project, %{"name" => "Renamed"})

      assert updated.name == "Renamed"
      assert Patterns.get_pattern_project!(scope, pattern_project.id).name == "Renamed"
    end

    test "switches to another of the scope's profiles and preloads it" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)
      new_profile = measurement_profile_fixture(scope, name: "New")

      assert {:ok, updated} =
               Patterns.update_pattern_project(scope, pattern_project, %{
                 "measurement_profile_id" => new_profile.id
               })

      assert updated.measurement_profile_id == new_profile.id
      assert updated.measurement_profile.id == new_profile.id
      assert updated.measurement_profile.name == "New"
    end

    test "rejects another user's profile and keeps the old one" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)
      other_profile = measurement_profile_fixture(user_scope_fixture())

      assert {:error, changeset} =
               Patterns.update_pattern_project(scope, pattern_project, %{
                 "measurement_profile_id" => other_profile.id
               })

      assert %{measurement_profile_id: ["is invalid"]} = errors_on(changeset)

      assert Patterns.get_pattern_project!(scope, pattern_project.id).measurement_profile_id ==
               pattern_project.measurement_profile_id
    end

    test "ignores block, definition, parameters and user_id" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      assert {:ok, updated} =
               Patterns.update_pattern_project(scope, pattern_project, %{
                 "name" => "Renamed",
                 "block" => "something_else",
                 "definition" => %{"version" => 1},
                 "parameters" => %{"ease_hip" => 60},
                 "user_id" => other_scope.user.id
               })

      reloaded = Patterns.get_pattern_project!(scope, updated.id)
      assert reloaded.name == "Renamed"
      assert reloaded.block == "straight_skirt"
      assert reloaded.definition == Blocks.definition("straight_skirt")
      assert reloaded.parameters == %{}
      assert reloaded.user_id == scope.user.id
    end

    test "with invalid data returns an error changeset" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      assert {:error, changeset} =
               Patterns.update_pattern_project(scope, pattern_project, %{"name" => ""})

      assert %{name: ["can't be blank"]} = errors_on(changeset)
      assert Patterns.get_pattern_project!(scope, pattern_project.id) == pattern_project
    end

    test "with another scope raises" do
      pattern_project = pattern_project_fixture(user_scope_fixture())

      assert_raise MatchError, fn ->
        Patterns.update_pattern_project(user_scope_fixture(), pattern_project, %{name: "x"})
      end
    end
  end

  describe "delete_pattern_project/2" do
    test "deletes the project" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      assert {:ok, %PatternProject{}} = Patterns.delete_pattern_project(scope, pattern_project)

      assert_raise Ecto.NoResultsError, fn ->
        Patterns.get_pattern_project!(scope, pattern_project.id)
      end
    end

    test "with another scope raises and keeps the project" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      assert_raise MatchError, fn ->
        Patterns.delete_pattern_project(user_scope_fixture(), pattern_project)
      end

      assert Patterns.get_pattern_project!(scope, pattern_project.id)
    end
  end

  describe "change_pattern_project/3" do
    test "gives the create changeset for a new project" do
      scope = user_scope_fixture()

      changeset =
        Patterns.change_pattern_project(scope, %PatternProject{}, %{"block" => "straight_skirt"})

      assert Ecto.Changeset.get_change(changeset, :block) == "straight_skirt"
    end

    test "gives the update changeset for a stored project, which does not cast block" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      changeset =
        Patterns.change_pattern_project(scope, pattern_project, %{
          "block" => "other",
          "name" => "x"
        })

      assert Ecto.Changeset.get_change(changeset, :name) == "x"
      refute Ecto.Changeset.get_change(changeset, :block)
    end

    test "with another scope raises for a stored project" do
      pattern_project = pattern_project_fixture(user_scope_fixture())

      assert_raise MatchError, fn ->
        Patterns.change_pattern_project(user_scope_fixture(), pattern_project)
      end
    end
  end

  describe "deleting the measurement profile" do
    test "keeps the project and clears its profile" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      {:ok, _} =
        Measurements.delete_measurement_profile(scope, pattern_project.measurement_profile)

      reloaded = Patterns.get_pattern_project!(scope, pattern_project.id)
      assert reloaded.measurement_profile_id == nil
      assert reloaded.measurement_profile == nil
    end

    test "clears only the profile id in the database, not the user id" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      {:ok, _} =
        Measurements.delete_measurement_profile(scope, pattern_project.measurement_profile)

      stored = Repo.get!(PatternProject, pattern_project.id)
      assert stored.measurement_profile_id == nil
      assert stored.user_id == scope.user.id
    end
  end

  describe "database constraints" do
    # These bypass `Toile.Patterns`, which checks ownership itself, to prove the database does too.

    test "a project cannot be inserted with another user's profile" do
      scope = user_scope_fixture()
      other_profile = measurement_profile_fixture(user_scope_fixture())

      changeset =
        PatternProject.create_changeset(
          %PatternProject{},
          %{name: "Skirt", block: "straight_skirt", measurement_profile_id: other_profile.id},
          scope
        )

      assert {:error, changeset} = Repo.insert(changeset)
      assert %{measurement_profile_id: ["does not exist"]} = errors_on(changeset)
    end

    test "a project cannot be pointed at another user's profile" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)
      other_profile = measurement_profile_fixture(user_scope_fixture())

      error =
        assert_raise Postgrex.Error, fn ->
          Repo.update_all(
            from(p in PatternProject, where: p.id == ^pattern_project.id),
            set: [measurement_profile_id: other_profile.id]
          )
        end

      assert error.postgres.code == :foreign_key_violation
      assert error.postgres.constraint == "pattern_projects_measurement_profile_id_fkey"
    end

    test "a project without a profile needs no matching profile" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      assert {1, _} =
               Repo.update_all(
                 from(p in PatternProject, where: p.id == ^pattern_project.id),
                 set: [measurement_profile_id: nil]
               )
    end

    test "deleting the user deletes their projects and profiles" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      assert {:ok, _} = Repo.delete(scope.user)

      refute Repo.get(PatternProject, pattern_project.id)
      refute Repo.get(Measurements.MeasurementProfile, pattern_project.measurement_profile_id)
    end
  end

  describe "definition size" do
    test "a definition over #{PatternProject.max_definition_bytes()} bytes is too large" do
      big = %{"version" => 1, "source" => String.duplicate("a", 1_000_000)}

      changeset =
        %PatternProject{}
        |> Ecto.Changeset.change(definition: big)
        |> PatternProject.validate_definition_size()

      assert %{definition: ["is too large"]} = errors_on(changeset)
    end

    test "a definition at the limit is accepted" do
      overhead = byte_size(JSON.encode!(%{"source" => ""}))

      fits = %{
        "source" => String.duplicate("a", PatternProject.max_definition_bytes() - overhead)
      }

      assert byte_size(JSON.encode!(fits)) == PatternProject.max_definition_bytes()

      changeset =
        %PatternProject{}
        |> Ecto.Changeset.change(definition: fits)
        |> PatternProject.validate_definition_size()

      assert changeset.valid?
    end
  end

  describe "subscribe_pattern_projects/1" do
    test "broadcasts create, update and delete only to the owner's topic" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      Patterns.subscribe_pattern_projects(scope)

      {:ok, pattern_project} = Patterns.create_pattern_project(scope, valid_attrs(scope))
      assert_receive {:created, ^pattern_project}

      {:ok, updated} = Patterns.update_pattern_project(scope, pattern_project, %{name: "New"})
      assert_receive {:updated, ^updated}

      {:ok, deleted} = Patterns.delete_pattern_project(scope, updated)
      assert_receive {:deleted, ^deleted}

      {:ok, _} = Patterns.create_pattern_project(other_scope, valid_attrs(other_scope))
      refute_receive {:created, %PatternProject{}}
    end
  end

  describe "missing_measurements/2" do
    test "lists the declared measurements without a value, in catalogue order" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      profile =
        measurement_profile_fixture(scope, measurements: %{waist: 680, bust: 900})

      assert Patterns.missing_measurements(pattern_project, profile) ==
               [:hip, :hip_height, :skirt_length]
    end

    test "lists armhole_depth for a bodice project whose profile lacks it" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope, block: "bodice")

      profile =
        measurement_profile_fixture(scope,
          measurements: Map.delete(complete_measurements(), :armhole_depth)
        )

      assert Patterns.missing_measurements(pattern_project, profile) == [:armhole_depth]
    end

    test "is empty for a complete profile" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      assert Patterns.missing_measurements(pattern_project, pattern_project.measurement_profile) ==
               []
    end

    test "includes the arm measurements only once the sleeve is added" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope, block: "bodice")

      profile =
        measurement_profile_fixture(scope,
          measurements: Map.drop(complete_measurements(), [:upper_arm, :wrist, :armhole_depth])
        )

      assert Patterns.missing_measurements(pattern_project, profile) == [:armhole_depth]

      with_sleeve = pattern_part_fixture(scope, pattern_project)

      assert Patterns.missing_measurements(with_sleeve, profile) ==
               Enum.filter(
                 Toile.Measurements.keys(),
                 &(&1 in [:upper_arm, :wrist, :armhole_depth])
               )
    end

    test "ignores declared names that are not catalogue keys and odd definitions" do
      profile = measurement_profile_fixture(user_scope_fixture())

      odd = %PatternProject{definition: %{"measurements" => ["hip", "tail", 42, "waist"]}}
      assert Patterns.missing_measurements(odd, profile) == [:waist, :hip]

      for definition <- [%{}, %{"measurements" => "hip"}, nil] do
        assert Patterns.missing_measurements(%PatternProject{definition: definition}, profile) ==
                 []
      end
    end
  end

  describe "engine_input/2" do
    test "gives the profile's millimetres without nils and the parameters by part name" do
      scope = user_scope_fixture()
      profile = measurement_profile_fixture(scope, measurements: %{waist: 680, hip: 940})

      pattern_project = %PatternProject{
        block: "straight_skirt",
        parameters: %{"ease_hip" => 60}
      }

      assert Patterns.engine_input(pattern_project, profile) == %{
               "measurements" => %{"waist" => 680, "hip" => 940},
               "parameters" => %{"straight_skirt" => %{"ease_hip" => 60}}
             }
    end

    test "gives empty parameters for a new project" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope)

      assert %{"parameters" => %{"straight_skirt" => %{}}} =
               Patterns.engine_input(pattern_project, pattern_project.measurement_profile)
    end

    test "gives every added part its own parameters" do
      scope = user_scope_fixture()

      pattern_project =
        scope
        |> pattern_project_fixture(block: "bodice")
        |> then(&pattern_part_fixture(scope, &1))

      [part] = pattern_project.parts

      assert Patterns.engine_input(
               %{pattern_project | parts: [%{part | parameters: %{"cap_ease" => 20}}]},
               pattern_project.measurement_profile
             )["parameters"] ==
               %{"bodice" => %{}, "straight_sleeve" => %{"cap_ease" => 20}}
    end
  end

  describe "engine_parts/1" do
    test "gives the main part named by the block, then the added parts" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope, block: "bodice")

      assert Patterns.engine_parts(pattern_project) == [
               %{"name" => "bodice", "definition" => Blocks.definition("bodice")}
             ]

      pattern_project = pattern_part_fixture(scope, pattern_project)

      assert Patterns.engine_parts(pattern_project) == [
               %{"name" => "bodice", "definition" => Blocks.definition("bodice")},
               %{
                 "name" => "straight_sleeve",
                 "definition" => Blocks.definition("straight_sleeve")
               }
             ]
    end
  end

  describe "addable_blocks/1" do
    test "offers the sleeve for a bodice project, nothing for a skirt project" do
      scope = user_scope_fixture()

      assert Patterns.addable_blocks(pattern_project_fixture(scope, block: "bodice")) ==
               ["straight_sleeve"]

      assert Patterns.addable_blocks(pattern_project_fixture(scope)) == []
    end

    test "does not offer a block the project already has" do
      scope = user_scope_fixture()

      pattern_project =
        scope
        |> pattern_project_fixture(block: "bodice")
        |> then(&pattern_part_fixture(scope, &1))

      assert Patterns.addable_blocks(pattern_project) == []
    end

    test "does not offer the sleeve to a bodice copy that lacks a value it imports" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope, block: "bodice")

      without =
        update_in(
          pattern_project.definition["formulas"],
          &Map.delete(&1, "back_armhole_to_notch")
        )

      assert Patterns.addable_blocks(without) == []
    end

    test "accepts an imported value declared as a parameter, a measurement or an import" do
      definition = Blocks.definition("bodice")
      formulas = definition["formulas"]

      as_parameter =
        definition
        |> Map.put("formulas", Map.delete(formulas, "back_armhole_to_notch"))
        |> Map.put("parameters", Map.put(definition["parameters"], "back_armhole_to_notch", 140))

      as_measurement =
        definition
        |> Map.put("formulas", Map.delete(formulas, "back_armhole_to_notch"))
        |> Map.put("measurements", ["back_armhole_to_notch" | definition["measurements"]])

      as_import =
        definition
        |> Map.put("formulas", Map.delete(formulas, "back_armhole_to_notch"))
        |> Map.put("imports", %{"back_armhole_to_notch" => "other.back_armhole_to_notch"})

      for definition <- [as_parameter, as_measurement, as_import] do
        project = %PatternProject{block: "bodice", definition: definition}
        assert Patterns.addable_blocks(project) == ["straight_sleeve"]
      end
    end

    test "is empty for odd stored definitions" do
      for definition <- [
            nil,
            %{},
            %{"formulas" => "x", "parameters" => [], "measurements" => 1, "imports" => "y"}
          ] do
        assert Patterns.addable_blocks(%PatternProject{block: "bodice", definition: definition}) ==
                 []
      end
    end
  end

  describe "add_part/3" do
    test "stores a copy of the block definition with no parameters and broadcasts" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope, block: "bodice")
      Patterns.subscribe_pattern_projects(scope)

      assert {:ok, %PatternProject{} = updated} =
               Patterns.add_part(scope, pattern_project, "straight_sleeve")

      assert [%PatternPart{} = part] = updated.parts
      assert part.name == "straight_sleeve"
      assert part.block == "straight_sleeve"
      assert part.definition == Blocks.definition("straight_sleeve")
      assert part.parameters == %{}
      assert updated.measurement_profile.id == pattern_project.measurement_profile_id
      assert_receive {:updated, ^updated}

      reloaded = Patterns.get_pattern_project!(scope, pattern_project.id)
      assert reloaded.parts == updated.parts
      # The main part is untouched.
      assert reloaded.definition == Blocks.definition("bodice")
    end

    test "refuses a second add of the same block, also from a stale project" do
      scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope, block: "bodice")

      assert {:ok, updated} = Patterns.add_part(scope, pattern_project, "straight_sleeve")
      assert {:error, :not_addable} = Patterns.add_part(scope, updated, "straight_sleeve")
      # The stale struct still has no parts; the stored row decides.
      assert {:error, :not_addable} = Patterns.add_part(scope, pattern_project, "straight_sleeve")

      assert [_one] = Patterns.get_pattern_project!(scope, pattern_project.id).parts
    end

    test "refuses unknown keys, base blocks, non-strings and blocks the project cannot take" do
      scope = user_scope_fixture()
      bodice = pattern_project_fixture(scope, block: "bodice")
      skirt = pattern_project_fixture(scope)
      Patterns.subscribe_pattern_projects(scope)

      for key <- ["ball_gown", "bodice", "straight_skirt", "", nil, :straight_sleeve, 1] do
        assert {:error, :not_addable} = Patterns.add_part(scope, bodice, key)
      end

      assert {:error, :not_addable} = Patterns.add_part(scope, skirt, "straight_sleeve")
      refute_receive {:updated, _}
      assert Patterns.get_pattern_project!(scope, bodice.id).parts == []
    end

    test "raises for another user's project" do
      scope = user_scope_fixture()
      other_scope = user_scope_fixture()
      pattern_project = pattern_project_fixture(scope, block: "bodice")

      assert_raise MatchError, fn ->
        Patterns.add_part(other_scope, pattern_project, "straight_sleeve")
      end

      # A struct claiming the other user still does not reach the row: the reload is scoped.
      assert_raise Ecto.NoResultsError, fn ->
        Patterns.add_part(
          other_scope,
          %{pattern_project | user_id: other_scope.user.id},
          "straight_sleeve"
        )
      end

      assert Patterns.get_pattern_project!(scope, pattern_project.id).parts == []
    end
  end

  describe "parts storage" do
    test "a row stored without parts reads as none, and parts must be a JSON array" do
      scope = user_scope_fixture()
      {1, _} = insert_projects(scope, 1)
      [%{id: id}] = Patterns.list_pattern_projects(scope)

      assert Patterns.get_pattern_project!(scope, id).parts == []

      assert_raise Postgrex.Error, ~r/parts_must_be_an_array/, fn ->
        Repo.query!("UPDATE pattern_projects SET parts = '{}'::jsonb WHERE id = $1", [
          Ecto.UUID.dump!(id)
        ])
      end
    end
  end

  # Inserts projects directly so the limit test does not run a hundred transactions.
  defp insert_projects(scope, count) do
    now = DateTime.utc_now(:second)

    rows =
      for i <- 1..count//1 do
        %{
          name: "Pattern #{i}",
          block: "straight_skirt",
          definition: %{"version" => 1},
          parameters: %{},
          user_id: scope.user.id,
          inserted_at: now,
          updated_at: now
        }
      end

    Repo.insert_all(PatternProject, rows)
  end
end
