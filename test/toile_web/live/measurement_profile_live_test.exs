defmodule ToileWeb.MeasurementProfileLiveTest do
  use ToileWeb.ConnCase, async: true

  import Phoenix.LiveViewTest
  import Toile.AccountsFixtures
  import Toile.MeasurementsFixtures
  import Toile.PatternsFixtures

  alias Toile.Measurements

  describe "logged out" do
    test "redirects every page to log in", %{conn: conn} do
      id = Ecto.UUID.generate()

      for path <- [
            "/measurements",
            "/measurements/new",
            "/measurements/#{id}",
            "/measurements/#{id}/edit"
          ] do
        assert {:error, {:redirect, %{to: "/users/log-in"}}} = live(conn, path)
      end
    end
  end

  describe "Index" do
    setup :register_and_log_in_user

    test "shows the empty state without profiles", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/measurements")

      assert has_element?(view, "h1", "Measurements")
      assert has_element?(view, "#measurement-profiles-empty")
      assert has_element?(view, ~s(#new-measurement-profile[href="/measurements/new"]))
    end

    test "lists only the user's own profiles with their missing counts", %{
      conn: conn,
      scope: scope
    } do
      partial = measurement_profile_fixture(scope, %{name: "Partial"})

      complete =
        measurement_profile_fixture(scope, %{name: "Full", measurements: complete_measurements()})

      one_missing =
        measurement_profile_fixture(scope, %{
          name: "Almost",
          measurements: Map.delete(complete_measurements(), :wrist)
        })

      other = measurement_profile_fixture(user_scope_fixture(), %{name: "Someone else"})

      {:ok, view, html} = live(conn, ~p"/measurements")

      refute has_element?(view, "#measurement-profiles-empty")
      assert has_element?(view, "#measurement_profiles-#{partial.id}", "Partial")

      assert has_element?(
               view,
               "#measurement_profiles-#{partial.id}-status",
               "18 measurements missing"
             )

      assert has_element?(view, "#measurement_profiles-#{complete.id}-status", "Complete")

      assert has_element?(
               view,
               "#measurement_profiles-#{one_missing.id}-status",
               "1 measurement missing"
             )

      refute has_element?(view, "#measurement_profiles-#{other.id}")
      refute html =~ "Someone else"
    end

    test "deletes a profile from the list", %{conn: conn, scope: scope} do
      profile = measurement_profile_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/measurements")

      assert has_element?(
               view,
               ~s(#measurement_profiles-#{profile.id} button[data-confirm="Delete this measurement profile?"])
             )

      view
      |> element("#measurement_profiles-#{profile.id} button", "Delete")
      |> render_click()

      refute has_element?(view, "#measurement_profiles-#{profile.id}")
      assert has_element?(view, "#measurement-profiles-empty")
      assert render(view) =~ "Measurement profile deleted"
      assert Measurements.list_measurement_profiles(scope) == []
    end
  end

  describe "New" do
    setup :register_and_log_in_user

    test "creates a profile from cm with a comma and shows it", %{conn: conn, scope: scope} do
      {:ok, view, _html} = live(conn, ~p"/measurements/new")

      assert has_element?(view, "h1", "New measurement profile")
      assert has_element?(view, "#measurement-field-armhole_depth input")
      assert has_element?(view, "#measurement-field-armhole_depth", "Nape to underarm level")

      result =
        view
        |> form("#measurement-profile-form",
          measurement_profile: %{name: "Me", measurements: %{waist: "72,5"}}
        )
        |> render_submit()

      assert [%{name: "Me"} = profile] = Measurements.list_measurement_profiles(scope)
      assert profile.measurements.waist == 725

      {:ok, show, html} = follow_redirect(result, conn, ~p"/measurements/#{profile}")
      assert html =~ "Measurement profile created"

      assert has_element?(show, "#measurement-waist-value", "72.5 cm")
      assert has_element?(show, "#measurement-hip-missing", "Missing")
    end

    test "saves a profile with only a name", %{conn: conn, scope: scope} do
      {:ok, view, _html} = live(conn, ~p"/measurements/new")

      {:ok, _show, _html} =
        view
        |> form("#measurement-profile-form", measurement_profile: %{name: "Only a name"})
        |> render_submit()
        |> follow_redirect(conn)

      assert [profile] = Measurements.list_measurement_profiles(scope)
      assert length(Measurements.missing_measurements(profile)) == length(Measurements.keys())
    end

    test "shows range, format and name errors while typing", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/measurements/new")

      for value <- ["300.1", "0", "-5"] do
        html =
          view
          |> form("#measurement-profile-form",
            measurement_profile: %{name: "Me", measurements: %{waist: value}}
          )
          |> render_change()

        assert html =~ "must be more than 0 and at most 300 cm",
               "expected #{value} to be rejected"
      end

      for value <- ["300", "0.1", "300,0"] do
        html =
          view
          |> form("#measurement-profile-form",
            measurement_profile: %{name: "Me", measurements: %{waist: value}}
          )
          |> render_change()

        refute html =~ "must be more than 0", "expected #{value} to be accepted"
      end

      view
      |> form("#measurement-profile-form",
        measurement_profile: %{name: "Me", measurements: %{waist: "72.55"}}
      )
      |> render_change()

      assert has_element?(
               view,
               "#measurement-field-waist",
               "must be a number in cm with at most one decimal"
             )

      assert has_element?(view, ~s(#measurement-field-waist input[value="72.55"]))

      html =
        view
        |> form("#measurement-profile-form", measurement_profile: %{name: ""})
        |> render_change()

      assert html =~ "can&#39;t be blank"

      html =
        view
        |> form("#measurement-profile-form",
          measurement_profile: %{name: String.duplicate("a", 101)}
        )
        |> render_change()

      assert html =~ "should be at most 100 character(s)"
    end

    test "rejects over-long input with the format error and echoes it truncated", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/measurements/new")

      view
      |> form("#measurement-profile-form",
        measurement_profile: %{name: "Me", measurements: %{waist: String.duplicate("9", 100_000)}}
      )
      |> render_change()

      assert has_element?(
               view,
               "#measurement-field-waist",
               "must be a number in cm with at most one decimal"
             )

      truncated = String.duplicate("9", 20) <> "…"
      assert has_element?(view, ~s(#measurement-field-waist input[value="#{truncated}"]))
    end

    test "rejects a number with more than five significant digits as out of range", %{
      conn: conn
    } do
      {:ok, view, _html} = live(conn, ~p"/measurements/new")

      html =
        view
        |> form("#measurement-profile-form",
          measurement_profile: %{name: "Me", measurements: %{waist: "123456"}}
        )
        |> render_change()

      assert html =~ "must be more than 0 and at most 300 cm"
    end

    test "does not save invalid input", %{conn: conn, scope: scope} do
      {:ok, view, _html} = live(conn, ~p"/measurements/new")

      html =
        view
        |> form("#measurement-profile-form",
          measurement_profile: %{name: "Me", measurements: %{waist: "abc"}}
        )
        |> render_submit()

      assert html =~ "must be a number in cm with at most one decimal"
      assert Measurements.list_measurement_profiles(scope) == []
    end

    test "shows the format error and an empty input for a non-string measurement", %{
      conn: conn,
      scope: scope
    } do
      {:ok, view, _html} = live(conn, ~p"/measurements/new")

      params = %{
        "measurement_profile" => %{"name" => "Me", "measurements" => %{"waist" => ["72"]}}
      }

      for {render, event} <- [{&render_change/3, "validate"}, {&render_submit/3, "save"}] do
        html = render.(view, event, params)

        assert html =~ "must be a number in cm with at most one decimal"
        assert has_element?(view, ~s(#measurement-field-waist input[value=""]))
      end

      assert Measurements.list_measurement_profiles(scope) == []
    end

    test "every measurement input is a touch-friendly decimal text field with help", %{
      conn: conn
    } do
      {:ok, view, _html} = live(conn, ~p"/measurements/new")

      for key <- Measurements.keys() do
        input = "#measurement-input-#{key}"

        assert has_element?(
                 view,
                 ~s(#{input}[type="text"][inputmode="decimal"][aria-describedby="help-#{key}"])
               )

        assert has_element?(view, "#{input}.input-lg.min-h-11")
        assert has_element?(view, "#help-#{key}")
      end

      assert has_element?(
               view,
               ~s(label[for="measurement-input-waist"]),
               "Waist circumference (cm)"
             )

      assert has_element?(view, "#save-measurement-profile.btn-lg.min-h-11", "Save")
      assert has_element?(view, "#cancel-measurement-profile.min-h-11")
      assert has_element?(view, ~s(#cancel-measurement-profile[href="/measurements"]))
    end
  end

  describe "Edit" do
    setup :register_and_log_in_user

    test "shows stored mm as cm and clears a measurement", %{conn: conn, scope: scope} do
      profile = measurement_profile_fixture(scope, %{measurements: %{waist: 725, hip: 1000}})

      {:ok, view, _html} = live(conn, ~p"/measurements/#{profile}/edit")

      assert has_element?(view, "h1", "Edit measurement profile")
      assert has_element?(view, ~s(#measurement-input-waist[value="72.5"]))
      assert has_element?(view, ~s(#measurement-input-hip[value="100.0"]))

      {:ok, _index, html} =
        view
        |> form("#measurement-profile-form",
          measurement_profile: %{name: "Renamed", measurements: %{waist: ""}}
        )
        |> render_submit()
        |> follow_redirect(conn, ~p"/measurements")

      assert html =~ "Measurement profile updated"
      assert html =~ "Renamed"

      updated = Measurements.get_measurement_profile!(scope, profile.id)
      assert updated.measurements.waist == nil
      assert updated.measurements.hip == 1000
    end

    test "does not save invalid input and keeps the stored profile", %{
      conn: conn,
      scope: scope
    } do
      profile = measurement_profile_fixture(scope, %{name: "Keep", measurements: %{waist: 725}})
      {:ok, view, _html} = live(conn, ~p"/measurements/#{profile}/edit")

      html =
        view
        |> form("#measurement-profile-form",
          measurement_profile: %{name: "", measurements: %{waist: "999"}}
        )
        |> render_submit()

      assert html =~ "can&#39;t be blank"
      assert html =~ "must be more than 0 and at most 300 cm"

      stored = Measurements.get_measurement_profile!(scope, profile.id)
      assert stored.name == "Keep"
      assert stored.measurements.waist == 725
    end

    test "returns to the show page when opened from there", %{conn: conn, scope: scope} do
      profile = measurement_profile_fixture(scope)

      {:ok, show, _html} = live(conn, ~p"/measurements/#{profile}")

      {:ok, view, _html} =
        show
        |> element("#edit-measurement-profile")
        |> render_click()
        |> follow_redirect(conn, ~p"/measurements/#{profile}/edit?return_to=show")

      assert has_element?(
               view,
               ~s(#cancel-measurement-profile[href="/measurements/#{profile.id}"])
             )

      {:ok, _show, html} =
        view
        |> form("#measurement-profile-form",
          measurement_profile: %{measurements: %{neck: "36"}}
        )
        |> render_submit()
        |> follow_redirect(conn, ~p"/measurements/#{profile}")

      assert html =~ "36.0 cm"
    end
  end

  describe "Edit from a pattern project" do
    setup :register_and_log_in_user

    test "the missing-measurements link returns to the pattern after saving", %{
      conn: conn,
      scope: scope
    } do
      profile = measurement_profile_fixture(scope, %{name: "Partial"})
      project = pattern_project_fixture(scope, measurement_profile_id: profile.id)
      edit_path = ~p"/measurements/#{profile}/edit?return_to=pattern&pattern_id=#{project.id}"

      {:ok, pattern, _html} = live(conn, ~p"/patterns/#{project}")

      {:ok, view, _html} =
        pattern
        |> element("#edit-profile-link")
        |> render_click()
        |> follow_redirect(conn, edit_path)

      assert has_element?(view, ~s(#cancel-measurement-profile[href="/patterns/#{project.id}"]))

      {:ok, pattern, _html} =
        view
        |> form("#measurement-profile-form",
          # The form takes centimetres: 50 cm is the fixture's 500 mm.
          measurement_profile: %{measurements: Map.new(Measurements.keys(), &{&1, "50"})}
        )
        |> render_submit()
        |> follow_redirect(conn, ~p"/patterns/#{project}")

      assert has_element?(pattern, "#pattern-canvas")
      refute has_element?(pattern, "#missing-measurements")
    end

    test "falls back to the profile page for a pattern_id that is not the user's own", %{
      conn: conn,
      scope: scope
    } do
      profile = measurement_profile_fixture(scope)
      other_project = pattern_project_fixture(user_scope_fixture())

      for pattern_id <- [other_project.id, Ecto.UUID.generate(), "not-a-uuid", "//evil.example"] do
        {:ok, view, _html} =
          live(conn, ~p"/measurements/#{profile}/edit?return_to=pattern&pattern_id=#{pattern_id}")

        assert has_element?(
                 view,
                 ~s(#cancel-measurement-profile[href="/measurements/#{profile.id}"])
               )
      end

      {:ok, view, _html} =
        live(
          conn,
          ~p"/measurements/#{profile}/edit?return_to=pattern&pattern_id=#{other_project.id}"
        )

      assert {:error, {:live_redirect, %{to: to}}} =
               view
               |> form("#measurement-profile-form",
                 measurement_profile: %{measurements: %{neck: "36"}}
               )
               |> render_submit()

      assert to == ~p"/measurements/#{profile}"
    end

    test "falls back to the profile page without a pattern_id", %{conn: conn, scope: scope} do
      profile = measurement_profile_fixture(scope)

      {:ok, view, _html} = live(conn, ~p"/measurements/#{profile}/edit?return_to=pattern")

      assert has_element?(
               view,
               ~s(#cancel-measurement-profile[href="/measurements/#{profile.id}"])
             )
    end
  end

  describe "Show" do
    setup :register_and_log_in_user

    test "lists every measurement with its value or a missing marker", %{
      conn: conn,
      scope: scope
    } do
      profile = measurement_profile_fixture(scope, %{name: "Mine", measurements: %{bust: 921}})

      {:ok, view, _html} = live(conn, ~p"/measurements/#{profile}")

      assert has_element?(view, "h1", "Mine")
      assert has_element?(view, "#measurement-bust", "Bust circumference")
      assert has_element?(view, "#measurement-bust-value", "92.1 cm")
      refute has_element?(view, "#measurement-bust-missing")

      for key <- Measurements.keys() -- [:bust] do
        assert has_element?(view, "#measurement-#{key}-missing", "Missing")
      end

      assert has_element?(view, ~s(#back-to-measurements[href="/measurements"]))
    end

    test "live-updates when the profile is changed elsewhere", %{conn: conn, scope: scope} do
      profile = measurement_profile_fixture(scope, %{name: "Before"})
      {:ok, view, _html} = live(conn, ~p"/measurements/#{profile}")

      assert has_element?(view, "#measurement-waist-missing")

      {:ok, _} =
        Measurements.update_measurement_profile(scope, profile, %{
          name: "After",
          measurements: %{waist: 725}
        })

      assert render(view) =~ "After"
      assert has_element?(view, "#measurement-waist-value", "72.5 cm")
      refute has_element?(view, "#measurement-waist-missing")
    end

    test "ignores changes to other profiles of the same user", %{conn: conn, scope: scope} do
      profile = measurement_profile_fixture(scope, %{name: "Mine"})
      other = measurement_profile_fixture(scope, %{name: "Other"})
      {:ok, view, _html} = live(conn, ~p"/measurements/#{profile}")

      {:ok, _} = Measurements.update_measurement_profile(scope, other, %{name: "Other 2"})
      {:ok, _} = Measurements.delete_measurement_profile(scope, other)

      assert has_element?(view, "h1", "Mine")
    end

    test "navigates away when the profile is deleted elsewhere", %{conn: conn, scope: scope} do
      profile = measurement_profile_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/measurements/#{profile}")

      {:ok, _} = Measurements.delete_measurement_profile(scope, profile)

      assert_redirect(view, ~p"/measurements")
    end
  end

  describe "another user's profile" do
    setup :register_and_log_in_user

    test "is not found on show and edit", %{conn: conn} do
      other = measurement_profile_fixture(user_scope_fixture())

      assert_raise Ecto.NoResultsError, fn -> live(conn, ~p"/measurements/#{other}") end
      assert_raise Ecto.NoResultsError, fn -> live(conn, ~p"/measurements/#{other}/edit") end
    end
  end
end
