defmodule ToileWeb.PatternLive.ShowTest do
  use ToileWeb.ConnCase, async: true

  import Phoenix.LiveViewTest
  import Toile.AccountsFixtures
  import Toile.MeasurementsFixtures
  import Toile.PatternsFixtures

  alias Toile.Measurements
  alias Toile.Patterns
  alias Toile.Patterns.Blocks

  @skirt %{waist: 680, hip: 940, hip_height: 206, skirt_length: 600}

  defp canvas_data(view, attribute) do
    view
    |> element("#pattern-canvas")
    |> render()
    |> LazyHTML.from_fragment()
    |> LazyHTML.attribute("data-#{attribute}")
    |> hd()
    |> JSON.decode!()
  end

  describe "logged out" do
    test "redirects to log in", %{conn: conn} do
      assert {:error, {:redirect, %{to: "/users/log-in"}}} =
               live(conn, ~p"/patterns/#{Ecto.UUID.generate()}")
    end
  end

  describe "Show" do
    setup :register_and_log_in_user

    test "hands the parts and engine input to the PatternView hook", %{
      conn: conn,
      scope: scope
    } do
      profile = measurement_profile_fixture(scope, %{name: "Me", measurements: @skirt})

      project =
        pattern_project_fixture(scope, name: "Summer skirt", measurement_profile_id: profile.id)

      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, "h1", "Summer skirt")
      assert has_element?(view, "header", "Straight skirt")
      assert page_title(view) =~ "Summer skirt"
      assert has_element?(view, ~s(#rename-pattern[href="/patterns/#{project.id}/edit"]))
      assert has_element?(view, ~s(#back-to-patterns[href="/patterns"]))
      assert has_element?(view, ~s(#profile-select option[value="#{profile.id}"][selected]), "Me")
      refute has_element?(view, ~s(#profile-select option[value=""]))

      assert has_element?(view, "#pattern #fit-pattern", "Fit to screen")
      assert has_element?(view, "#pattern-view-#{profile.id} #pattern-canvas")

      assert has_element?(
               view,
               ~s(#pattern-canvas[phx-hook="PatternView"][phx-update="ignore"][data-key="#{profile.id}"])
             )

      stored = Patterns.get_pattern_project!(scope, project.id)

      assert canvas_data(view, "parts") == [
               %{"name" => "straight_skirt", "definition" => stored.definition}
             ]

      assert canvas_data(view, "input") == %{
               "measurements" => Map.new(@skirt, fn {k, v} -> {Atom.to_string(k), v} end),
               "parameters" => %{"straight_skirt" => %{}}
             }

      assert canvas_data(view, "piece-labels") == %{"back" => "Back", "front" => "Front"}

      refute has_element?(view, "#missing-measurements")
      refute has_element?(view, "#no-profile")
      # Nothing can be added to a skirt.
      refute has_element?(view, "#add-parts")
    end

    test "uses the wide layout", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, "#main-content.max-w-7xl")
    end

    test "switching the profile saves it and redraws with its measurements", %{
      conn: conn,
      scope: scope
    } do
      first = measurement_profile_fixture(scope, %{name: "First", measurements: @skirt})

      second =
        measurement_profile_fixture(scope, %{
          name: "Second",
          measurements: %{@skirt | waist: 800, hip: 1000}
        })

      project = pattern_project_fixture(scope, measurement_profile_id: first.id)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, "#pattern-view-#{first.id}")

      view
      |> form("#profile-form", %{measurement_profile_id: second.id})
      |> render_change()

      assert Patterns.get_pattern_project!(scope, project.id).measurement_profile_id == second.id
      refute has_element?(view, "#pattern-view-#{first.id}")
      assert has_element?(view, "#pattern-view-#{second.id} #pattern-canvas")
      assert has_element?(view, ~s(#pattern-canvas[data-key="#{second.id}"]))
      assert %{"waist" => 800, "hip" => 1000} = canvas_data(view, "input")["measurements"]
    end

    test "lists missing measurements instead of drawing", %{conn: conn, scope: scope} do
      profile =
        measurement_profile_fixture(scope, %{
          name: "No hip",
          measurements: Map.delete(@skirt, :hip)
        })

      project = pattern_project_fixture(scope, measurement_profile_id: profile.id)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, "#missing-measurements", "Measurements missing for this pattern")
      assert has_element?(view, "#missing-measurement-hip", "Hip circumference")
      # Only measurements the definition declares are listed.
      refute has_element?(view, "#missing-measurement-bust")

      assert has_element?(
               view,
               ~s(#edit-profile-link[href="/measurements/#{profile.id}/edit?return_to=pattern&pattern_id=#{project.id}"])
             )

      refute has_element?(view, "#pattern-canvas")
      refute has_element?(view, "#no-profile")
    end

    test "switching from an incomplete to a complete profile shows the drawing", %{
      conn: conn,
      scope: scope
    } do
      incomplete = measurement_profile_fixture(scope, %{name: "Empty"})
      complete = measurement_profile_fixture(scope, %{name: "Full", measurements: @skirt})
      project = pattern_project_fixture(scope, measurement_profile_id: incomplete.id)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, "#missing-measurements")

      view
      |> form("#profile-form", %{measurement_profile_id: complete.id})
      |> render_change()

      refute has_element?(view, "#missing-measurements")
      assert has_element?(view, "#pattern-view-#{complete.id} #pattern-canvas")
    end

    test "draws a bodice project", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope, block: "bodice")
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, "header", "Bodice")
      assert has_element?(view, "#pattern-view-#{project.measurement_profile_id} #pattern-canvas")

      assert canvas_data(view, "parts") == [
               %{"name" => "bodice", "definition" => Blocks.definition("bodice")}
             ]

      measurements = canvas_data(view, "input")["measurements"]

      for key <- Blocks.definition("bodice")["measurements"] do
        assert measurements[key] == 500
      end

      refute has_element?(view, "#missing-measurements")
    end

    test "lists armhole depth as missing for a bodice", %{conn: conn, scope: scope} do
      profile =
        measurement_profile_fixture(scope, %{
          name: "No armhole depth",
          measurements: Map.delete(complete_measurements(), :armhole_depth)
        })

      project =
        pattern_project_fixture(scope, block: "bodice", measurement_profile_id: profile.id)

      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, "#missing-measurement-armhole_depth", "Nape to underarm level")
      # The rest of the profile is complete, so armhole depth is the only entry.
      missing =
        view
        |> render()
        |> LazyHTML.from_document()
        |> LazyHTML.query("#missing-measurements li")

      assert Enum.count(missing) == 1
      # hip is in the profile's catalogue but not a bodice measurement.
      refute has_element?(view, "#missing-measurement-hip")
      refute has_element?(view, "#missing-measurement-bust")
      refute has_element?(view, "#pattern-canvas")
    end

    test "asks for a profile when the project has none", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      profile = Measurements.get_measurement_profile!(scope, project.measurement_profile_id)
      {:ok, _} = Measurements.delete_measurement_profile(scope, profile)
      other = measurement_profile_fixture(scope, %{name: "Another", measurements: @skirt})

      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, "#no-profile")

      assert has_element?(
               view,
               ~s(#profile-select option[value=""]),
               "Choose a measurement profile"
             )

      refute has_element?(view, "#pattern-canvas")
      refute has_element?(view, "#missing-measurements")

      # Choosing the prompt again changes nothing.
      view |> form("#profile-form", %{measurement_profile_id: ""}) |> render_change()
      assert has_element?(view, "#no-profile")

      view
      |> form("#profile-form", %{measurement_profile_id: other.id})
      |> render_change()

      assert has_element?(view, "#pattern-view-#{other.id} #pattern-canvas")
    end

    test "rejects another user's profile and keeps the old one", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      foreign = measurement_profile_fixture(user_scope_fixture())
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert {:error, {:live_redirect, %{to: path}}} =
               render_change(view, "select_profile", %{"measurement_profile_id" => foreign.id})

      assert path == ~p"/patterns/#{project}"

      assert Patterns.get_pattern_project!(scope, project.id).measurement_profile_id ==
               project.measurement_profile_id

      {:ok, reloaded, html} = live(conn, path)
      refute html =~ foreign.id

      assert has_element?(
               reloaded,
               ~s(#profile-select option[value="#{project.measurement_profile_id}"][selected])
             )
    end

    test "flashes an error when the profile cannot be changed", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      {:ok, _reloaded, html} =
        view
        |> render_change("select_profile", %{"measurement_profile_id" => "not-a-uuid"})
        |> follow_redirect(conn, ~p"/patterns/#{project}")

      assert html =~ "Could not change the measurement profile"
    end

    test "adds the sleeve to a bodice project and draws it with the bodice", %{
      conn: conn,
      scope: scope
    } do
      project = pattern_project_fixture(scope, block: "bodice")
      Patterns.subscribe_pattern_projects(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, "#add-parts h2", "Add to the pattern")
      assert has_element?(view, ~s(#add-part-straight_sleeve[phx-value-block="straight_sleeve"]))
      assert has_element?(view, "#add-part-straight_sleeve", "Straight sleeve")

      html = view |> element("#add-part-straight_sleeve") |> render_click()

      assert html =~ "Straight sleeve added"
      assert_receive {:updated, %{id: id}} when id == project.id

      assert [
               %{"name" => "bodice", "definition" => bodice},
               %{"name" => "straight_sleeve", "definition" => sleeve}
             ] = canvas_data(view, "parts")

      assert bodice == Blocks.definition("bodice")
      assert sleeve == Blocks.definition("straight_sleeve")

      assert canvas_data(view, "input")["parameters"] == %{
               "bodice" => %{},
               "straight_sleeve" => %{}
             }

      assert canvas_data(view, "piece-labels") == %{
               "back" => "Back",
               "front" => "Front",
               "sleeve" => "Sleeve"
             }

      # The sleeve cannot be added twice.
      refute has_element?(view, "#add-parts")
      assert [%{name: "straight_sleeve"}] = Patterns.get_pattern_project!(scope, project.id).parts
    end

    test "lists the sleeve's measurements as missing once it is added", %{
      conn: conn,
      scope: scope
    } do
      profile =
        measurement_profile_fixture(scope, %{
          name: "No upper arm",
          measurements: Map.delete(complete_measurements(), :upper_arm)
        })

      project =
        pattern_project_fixture(scope, block: "bodice", measurement_profile_id: profile.id)

      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      # The bodice does not need the upper arm.
      assert has_element?(view, "#pattern-canvas")

      view |> element("#add-part-straight_sleeve") |> render_click()

      assert has_element?(view, "#missing-measurement-upper_arm", "Upper arm circumference")
      refute has_element?(view, "#pattern-canvas")
    end

    test "flashes an error when the sleeve was added meanwhile", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope, block: "bodice")
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      # Added in another tab: the button is still on this page.
      pattern_part_fixture(scope, project)

      {:ok, reloaded, html} =
        view
        |> element("#add-part-straight_sleeve")
        |> render_click()
        |> follow_redirect(conn, ~p"/patterns/#{project}")

      assert html =~ "Could not add to the pattern"
      refute has_element?(reloaded, "#add-parts")
      assert [_sleeve] = Patterns.get_pattern_project!(scope, project.id).parts
    end

    test "rejects blocks that cannot be added", %{conn: conn, scope: scope} do
      # A skirt project offers nothing; a client may still send any key.
      project = pattern_project_fixture(scope)

      for params <- [
            %{"block" => "straight_sleeve"},
            %{"block" => "bodice"},
            %{"block" => "unknown"},
            %{"block" => ["straight_sleeve"]},
            %{}
          ] do
        {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")
        refute has_element?(view, "#add-parts")

        {:ok, _reloaded, html} =
          view
          |> render_click("add_part", params)
          |> follow_redirect(conn, ~p"/patterns/#{project}")

        assert html =~ "Could not add to the pattern"
      end

      assert Patterns.get_pattern_project!(scope, project.id).parts == []
    end

    test "cannot add to another user's project", %{conn: conn} do
      other_scope = user_scope_fixture()
      other = pattern_project_fixture(other_scope, block: "bodice")

      assert_raise Ecto.NoResultsError, fn ->
        live(conn, ~p"/patterns/#{other}")
      end

      assert Patterns.get_pattern_project!(other_scope, other.id).parts == []
    end

    test "raises for another user's project", %{conn: conn} do
      other = pattern_project_fixture(user_scope_fixture())

      assert_raise Ecto.NoResultsError, fn ->
        live(conn, ~p"/patterns/#{other}")
      end
    end
  end
end
