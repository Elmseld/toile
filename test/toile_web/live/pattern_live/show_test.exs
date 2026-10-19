defmodule ToileWeb.PatternLive.ShowTest do
  use ToileWeb.ConnCase, async: true

  import Ecto.Query, only: [from: 2]
  import Phoenix.LiveViewTest
  import Toile.AccountsFixtures
  import Toile.MeasurementsFixtures
  import Toile.PatternsFixtures

  alias Toile.Measurements
  alias Toile.Patterns
  alias Toile.Patterns.Blocks
  alias Toile.Patterns.PatternProject
  alias Toile.Repo

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

    test "hands the definition and engine input to the PatternView hook", %{
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
      assert has_element?(view, "#pattern #pattern-canvas")

      assert has_element?(
               view,
               ~s(#pattern-canvas[phx-hook="PatternView"][phx-update="ignore"][data-key="#{profile.id}"])
             )

      stored = Patterns.get_pattern_project!(scope, project.id)
      assert canvas_data(view, "definition") == stored.definition

      assert canvas_data(view, "input") == %{
               "measurements" => Map.new(@skirt, fn {k, v} -> {Atom.to_string(k), v} end),
               "parameters" => %{}
             }

      assert canvas_data(view, "piece-labels") == %{"back" => "Back", "front" => "Front"}

      refute has_element?(view, "#missing-measurements")
      refute has_element?(view, "#no-profile")
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

      assert has_element?(view, ~s(#pattern-canvas[data-key="#{first.id}"]))

      view
      |> form("#profile-form", %{measurement_profile_id: second.id})
      |> render_change()

      assert Patterns.get_pattern_project!(scope, project.id).measurement_profile_id == second.id
      # The hook element is kept, so the editor's history survives the switch.
      refute has_element?(view, "[id^=pattern-view-]")
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
      assert has_element?(view, ~s(#pattern-canvas[data-key="#{complete.id}"]))
    end

    test "draws a bodice project", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope, block: "bodice")
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, "header", "Bodice")

      assert has_element?(
               view,
               ~s(#pattern-canvas[data-key="#{project.measurement_profile_id}"])
             )

      assert canvas_data(view, "definition") == Blocks.definition("bodice")

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

      assert has_element?(view, ~s(#pattern-canvas[data-key="#{other.id}"]))
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

    test "renders the editor aside for the hook", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, ~s(#pattern-editor[phx-update="ignore"]))
      assert has_element?(view, ~s(#pattern-canvas[data-editor="pattern-editor"]))
      assert has_element?(view, "#undo-button[disabled]", "Undo")
      assert has_element?(view, "#redo-button[disabled]", "Redo")
      assert has_element?(view, ~s(#save-status[role="status"][aria-live="polite"]))
      assert has_element?(view, "#point-details")

      assert has_element?(view, ~s(#point-select option[value=""]), "Choose a point")

      for %{"name" => name} <- project.definition["points"] do
        assert has_element?(view, ~s(#point-select option[value="#{name}"]), name)
      end

      assert has_element?(
               view,
               ~s(#parameter-ease_hip[data-parameter="ease_hip"][data-unit="length"][data-default="40"]),
               "Ease at the hip (cm)"
             )

      assert has_element?(view, ~s(#parameter-ease_hip-input[value="4"][inputmode="decimal"]))
      assert has_element?(view, "#parameter-ease_hip-hint", "Default: 4 cm")
      assert has_element?(view, "#parameter-side_rise-hint", "Default: 1.25 cm")
      assert has_element?(view, "#parameter-ease_hip-error")

      texts = canvas_data(view, "texts")
      assert texts["errors"]["unknown_reference"] == "There is nothing called %{name}."
      assert texts["status"]["saved"] == "Saved"
    end

    test "lists the parameters in display order", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope, block: "bodice")
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      rows =
        view
        |> element("#parameter-panel")
        |> render()
        |> LazyHTML.from_fragment()
        |> LazyHTML.query("[data-parameter]")
        |> LazyHTML.attribute("data-parameter")

      assert rows ==
               ToileWeb.ParameterTexts.sort(Map.keys(Blocks.definition("bodice")["parameters"]))

      assert hd(rows) == "ease_bust"

      assert has_element?(
               view,
               ~s(#parameter-bust_dart_rate[data-unit="angle_per_length"][data-default="0.12"]),
               "Bust dart growth (degrees per cm)"
             )

      assert has_element?(view, "#parameter-bust_dart_rate-hint", "Default: 1.2 degrees per cm")
    end

    test "renders the editor for a definition without points or known parameters", %{
      conn: conn,
      scope: scope
    } do
      project = pattern_project_fixture(scope)

      {1, _} =
        Repo.update_all(
          from(p in PatternProject, where: p.id == ^project.id),
          set: [definition: %{"version" => 1, "measurements" => [], "parameters" => []}]
        )

      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, "#pattern-canvas")
      refute has_element?(view, "#point-select option:not([value=''])")
      refute has_element?(view, "#parameter-panel")
      assert canvas_data(view, "piece-labels") == %{}

      {1, _} =
        Repo.update_all(
          from(p in PatternProject, where: p.id == ^project.id),
          set: [
            definition: %{"version" => 1, "measurements" => [], "parameters" => %{"pocket" => 3}},
            parameters: %{"pocket" => 2.5}
          ]
        )

      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      assert has_element?(view, ~s(#parameter-pocket[data-unit="number"]), "pocket")
      refute has_element?(view, "#parameter-pocket", "pocket (")
      assert has_element?(view, ~s(#parameter-pocket-input[value="2.5"]))
      assert has_element?(view, "#parameter-pocket-hint", "Default: 3")
    end

    test "saves edits through save_pattern and shows them after a reload", %{
      conn: conn,
      scope: scope
    } do
      project = pattern_project_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      definition =
        update_in(project.definition, ["points", Access.at(2)], fn point ->
          Map.put(point, "user_offset", %{"dx" => 12.5, "dy" => -3})
        end)

      %{"name" => moved} = Enum.at(definition["points"], 2)

      render_hook(view, "save_pattern", %{
        "definition" => definition,
        "parameters" => %{"ease_hip" => 50}
      })

      assert_reply(view, %{ok: true})

      {:ok, view2, _html} = live(conn, ~p"/patterns/#{project}")

      saved = Enum.find(canvas_data(view2, "definition")["points"], &(&1["name"] == moved))
      assert saved["user_offset"] == %{"dx" => 12.5, "dy" => -3}
      assert canvas_data(view2, "input")["parameters"] == %{"ease_hip" => 50}
      assert has_element?(view2, ~s(#parameter-ease_hip-input[value="5"]))
    end

    test "a save does not send the definition back to the hook", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      definition = put_in(project.definition, ["points", Access.at(0), "x"], "10")

      render_hook(view, "save_pattern", %{"definition" => definition, "parameters" => %{}})
      assert_reply(view, %{ok: true})

      assert canvas_data(view, "definition") == project.definition
      assert Patterns.get_pattern_project!(scope, project.id).definition == definition
    end

    test "rejects a save that renames a point", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      definition = put_in(project.definition, ["points", Access.at(0), "name"], "renamed")

      render_hook(view, "save_pattern", %{"definition" => definition, "parameters" => %{}})
      assert_reply(view, %{ok: false})

      assert Patterns.get_pattern_project!(scope, project.id).definition == project.definition
    end

    test "rejects saves that touch the protected parts and stores nothing", %{
      conn: conn,
      scope: scope
    } do
      project = pattern_project_fixture(scope, block: "bodice")
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")
      definition = project.definition

      tampered = [
        {put_in(definition, ["formulas", "armhole_length"], "0"), %{}},
        {put_in(definition, ["parameters", "ease_bust"], 99), %{}},
        {put_in(definition, ["curves", Access.at(0), "name"], "x"), %{}},
        {put_in(definition, ["pieces", Access.at(0), "name"], "x"), %{}},
        {Map.update!(definition, "points", &Enum.drop(&1, 1)), %{}},
        {put_in(definition, ["points", Access.at(0), "user_offset"], %{"dx" => "1", "dy" => 0}),
         %{}},
        {definition, %{"not_a_parameter" => 1}},
        {definition, %{"ease_bust" => "40"}}
      ]

      for {payload_definition, parameters} <- tampered do
        render_hook(view, "save_pattern", %{
          "definition" => payload_definition,
          "parameters" => parameters
        })

        assert_reply(view, %{ok: false})
      end

      assert Patterns.get_pattern_project!(scope, project.id) == project
    end

    test "a second save can remove the offset and the overrides again", %{
      conn: conn,
      scope: scope
    } do
      project = pattern_project_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      moved =
        put_in(project.definition, ["points", Access.at(1), "user_offset"], %{
          "dx" => 1,
          "dy" => 2
        })

      render_hook(view, "save_pattern", %{
        "definition" => moved,
        "parameters" => %{"ease_hip" => 50}
      })

      assert_reply(view, %{ok: true})

      render_hook(view, "save_pattern", %{"definition" => project.definition, "parameters" => %{}})

      assert_reply(view, %{ok: true})

      stored = Patterns.get_pattern_project!(scope, project.id)
      assert stored.definition == project.definition
      assert stored.parameters == %{}

      {:ok, view2, _html} = live(conn, ~p"/patterns/#{project}")
      assert canvas_data(view2, "definition") == project.definition
      assert canvas_data(view2, "input")["parameters"] == %{}
    end

    test "rejects a malformed save", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      for payload <- [
            %{"definition" => "x"},
            %{"definition" => "x", "parameters" => %{}},
            %{"definition" => project.definition, "parameters" => ["ease_hip"]},
            %{}
          ] do
        render_hook(view, "save_pattern", payload)
        assert_reply(view, %{ok: false})
      end

      assert Patterns.get_pattern_project!(scope, project.id) == project
    end

    test "switching the profile after a save keeps the canvas and sends the saved parameters", %{
      conn: conn,
      scope: scope
    } do
      first = measurement_profile_fixture(scope, %{name: "First", measurements: @skirt})
      second = measurement_profile_fixture(scope, %{name: "Second", measurements: @skirt})
      project = pattern_project_fixture(scope, measurement_profile_id: first.id)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}")

      render_hook(view, "save_pattern", %{
        "definition" => project.definition,
        "parameters" => %{"ease_hip" => 60}
      })

      assert_reply(view, %{ok: true})
      # The input is not re-sent on save: the hook already has the parameters.
      assert canvas_data(view, "input")["parameters"] == %{}

      view
      |> form("#profile-form", %{measurement_profile_id: second.id})
      |> render_change()

      assert has_element?(view, ~s(#pattern-canvas[data-key="#{second.id}"]))
      assert canvas_data(view, "input")["parameters"] == %{"ease_hip" => 60}
    end

    test "raises for another user's project", %{conn: conn} do
      other = pattern_project_fixture(user_scope_fixture())

      assert_raise Ecto.NoResultsError, fn ->
        live(conn, ~p"/patterns/#{other}")
      end
    end
  end
end
