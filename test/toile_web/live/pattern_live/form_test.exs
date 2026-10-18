defmodule ToileWeb.PatternLive.FormTest do
  use ToileWeb.ConnCase, async: true

  import Phoenix.LiveViewTest
  import Toile.AccountsFixtures
  import Toile.MeasurementsFixtures
  import Toile.PatternsFixtures

  alias Toile.Patterns
  alias Toile.Patterns.Blocks

  describe "New" do
    setup :register_and_log_in_user

    test "creates a project from a block and a profile and shows it", %{
      conn: conn,
      scope: scope
    } do
      profile = measurement_profile_fixture(scope, %{name: "Me"})
      {:ok, view, _html} = live(conn, ~p"/patterns/new")

      assert has_element?(view, "h1", "New pattern")
      assert has_element?(view, ~s(#pattern-form select[name="pattern_project[block]"]))
      assert has_element?(view, ~s(option[value="bodice"]), "Bodice")
      assert has_element?(view, ~s(option[value="straight_skirt"]), "Straight skirt")
      assert has_element?(view, ~s(option[value=""]), "Choose a block")
      # With several blocks none is preselected; the user picks one.
      refute has_element?(view, ~s(select[name="pattern_project[block]"] option[selected]))
      assert has_element?(view, ~s(option[value="#{profile.id}"]), "Me")
      assert has_element?(view, ~s(option[value=""]), "Choose a measurement profile")

      result =
        view
        |> form("#pattern-form",
          pattern_project: %{
            name: "Summer skirt",
            block: "straight_skirt",
            measurement_profile_id: profile.id
          }
        )
        |> render_submit()

      assert [%{name: "Summer skirt"} = listed] = Patterns.list_pattern_projects(scope)
      project = Patterns.get_pattern_project!(scope, listed.id)
      assert project.block == "straight_skirt"
      assert project.measurement_profile_id == profile.id
      assert project.definition == Blocks.definition("straight_skirt")

      {:ok, _show, html} = follow_redirect(result, conn, ~p"/patterns/#{project}")
      assert html =~ "Pattern created"
      assert html =~ "Summer skirt"
    end

    test "creates a bodice project", %{conn: conn, scope: scope} do
      profile = measurement_profile_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/new")

      result =
        view
        |> form("#pattern-form",
          pattern_project: %{
            name: "First bodice",
            block: "bodice",
            measurement_profile_id: profile.id
          }
        )
        |> render_submit()

      assert [listed] = Patterns.list_pattern_projects(scope)
      project = Patterns.get_pattern_project!(scope, listed.id)
      assert project.block == "bodice"
      assert project.definition == Blocks.definition("bodice")

      {:ok, show, _html} = follow_redirect(result, conn, ~p"/patterns/#{project}")
      assert has_element?(show, "header", "Bodice")
    end

    test "requires a block", %{conn: conn, scope: scope} do
      profile = measurement_profile_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/new")

      html =
        view
        |> form("#pattern-form",
          pattern_project: %{name: "No block", block: "", measurement_profile_id: profile.id}
        )
        |> render_submit()

      assert html =~ "can&#39;t be blank"
      assert has_element?(view, ~s(select.select-error[name="pattern_project[block]"]))

      refute has_element?(
               view,
               ~s(select.select-error[name="pattern_project[measurement_profile_id]"])
             )

      assert Patterns.list_pattern_projects(scope) == []
    end

    test "shows validation errors", %{conn: conn, scope: scope} do
      measurement_profile_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/new")

      html =
        view
        |> form("#pattern-form", pattern_project: %{name: String.duplicate("a", 101)})
        |> render_change()

      assert html =~ "should be at most 100 character(s)"

      html =
        view
        |> form("#pattern-form", pattern_project: %{name: "", measurement_profile_id: ""})
        |> render_submit()

      assert html =~ "can&#39;t be blank"
      assert Patterns.list_pattern_projects(scope) == []
    end

    test "rejects another user's profile", %{conn: conn, scope: scope} do
      measurement_profile_fixture(scope)
      other_profile = measurement_profile_fixture(user_scope_fixture())
      {:ok, view, _html} = live(conn, ~p"/patterns/new")

      html =
        render_submit(view, "save", %{
          "pattern_project" => %{
            "name" => "Skirt",
            "block" => "straight_skirt",
            "measurement_profile_id" => other_profile.id
          }
        })

      assert html =~ "is invalid"
      assert Patterns.list_pattern_projects(scope) == []
    end

    test "asks for a measurement profile first when the user has none", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/patterns/new")

      assert has_element?(view, "#no-profiles")
      assert has_element?(view, ~s(#no-profiles a[href="/measurements/new"]))
      refute has_element?(view, "#pattern-form")
      refute has_element?(view, "#save-pattern")
    end

    test "only offers the user's own profiles", %{conn: conn, scope: scope} do
      measurement_profile_fixture(scope, %{name: "Mine"})
      other = measurement_profile_fixture(user_scope_fixture(), %{name: "Theirs"})

      {:ok, view, html} = live(conn, ~p"/patterns/new")

      refute has_element?(view, ~s(option[value="#{other.id}"]))
      refute html =~ "Theirs"
    end

    test "cancel goes back to the list", %{conn: conn, scope: scope} do
      measurement_profile_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/new")

      assert has_element?(view, ~s(#cancel-pattern[href="/patterns"]))
    end
  end

  describe "Edit" do
    setup :register_and_log_in_user

    test "renames a project and returns to it", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope, name: "Old name")
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}/edit")

      assert has_element?(view, "h1", "Rename pattern")

      assert has_element?(
               view,
               ~s(#pattern-form input[name="pattern_project[name]"][value="Old name"])
             )

      refute has_element?(view, ~s(select[name="pattern_project[block]"]))
      refute has_element?(view, ~s(select[name="pattern_project[measurement_profile_id]"]))
      assert has_element?(view, ~s(#cancel-pattern[href="/patterns/#{project.id}"]))

      result =
        view
        |> form("#pattern-form", pattern_project: %{name: "New name"})
        |> render_submit()

      {:ok, _show, html} = follow_redirect(result, conn, ~p"/patterns/#{project}")
      assert html =~ "Pattern renamed"
      assert Patterns.get_pattern_project!(scope, project.id).name == "New name"
    end

    test "rename ignores a profile id in the params", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      other_profile = measurement_profile_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}/edit")

      render_submit(view, "save", %{
        "pattern_project" => %{"name" => "Renamed", "measurement_profile_id" => other_profile.id}
      })

      stored = Patterns.get_pattern_project!(scope, project.id)
      assert stored.name == "Renamed"
      assert stored.measurement_profile_id == project.measurement_profile_id
    end

    test "shows validation errors", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns/#{project}/edit")

      html =
        view
        |> form("#pattern-form", pattern_project: %{name: ""})
        |> render_submit()

      assert html =~ "can&#39;t be blank"
    end

    test "raises for another user's project", %{conn: conn} do
      other = pattern_project_fixture(user_scope_fixture())

      assert_raise Ecto.NoResultsError, fn ->
        live(conn, ~p"/patterns/#{other}/edit")
      end
    end
  end
end
