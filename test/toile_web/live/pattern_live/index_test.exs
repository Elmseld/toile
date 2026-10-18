defmodule ToileWeb.PatternLive.IndexTest do
  use ToileWeb.ConnCase, async: true

  import ExUnit.CaptureLog
  import Phoenix.LiveViewTest
  import Toile.AccountsFixtures
  import Toile.MeasurementsFixtures
  import Toile.PatternsFixtures

  alias Toile.Measurements
  alias Toile.Patterns

  describe "logged out" do
    test "redirects to the login page with an error flash", %{conn: conn} do
      assert {:error, {:redirect, %{to: path, flash: flash}}} = live(conn, ~p"/patterns")
      assert path == ~p"/users/log-in"
      assert %{"error" => _} = flash
    end

    test "returns to /patterns after login", %{conn: conn} do
      conn = get(conn, ~p"/patterns")
      assert redirected_to(conn) == ~p"/users/log-in"
      assert get_session(conn, :user_return_to) == ~p"/patterns"
    end

    test "redirects every pattern page to log in", %{conn: conn} do
      id = Ecto.UUID.generate()

      for path <- ["/patterns/new", "/patterns/#{id}", "/patterns/#{id}/edit"] do
        assert {:error, {:redirect, %{to: "/users/log-in"}}} = live(conn, path)
      end
    end
  end

  describe "logged in" do
    setup :register_and_log_in_user

    test "shows the heading and the empty state", %{conn: conn} do
      {:ok, view, html} = live(conn, ~p"/patterns")

      assert has_element?(view, "#my-patterns h1", "My patterns")
      assert has_element?(view, "#patterns-empty")
      refute has_element?(view, "#pattern_projects")
      assert html =~ "My patterns"
      assert page_title(view) =~ "My patterns"
    end

    test "links to the new pattern page", %{conn: conn} do
      {:ok, view, _html} = live(conn, ~p"/patterns")

      assert has_element?(view, ~s(#new-pattern[href="/patterns/new"]), "New pattern")

      assert {:ok, _form, html} =
               view
               |> element("#new-pattern")
               |> render_click()
               |> follow_redirect(conn, ~p"/patterns/new")

      assert html =~ "New pattern"
    end

    test "lists only the user's own projects with block and profile", %{
      conn: conn,
      scope: scope
    } do
      profile = measurement_profile_fixture(scope, %{name: "Me in May"})

      project =
        pattern_project_fixture(scope, name: "Summer skirt", measurement_profile_id: profile.id)

      other = pattern_project_fixture(user_scope_fixture(), name: "Someone else's skirt")

      {:ok, view, html} = live(conn, ~p"/patterns")

      refute has_element?(view, "#patterns-empty")
      assert has_element?(view, "#pattern_projects-#{project.id}", "Summer skirt")
      assert has_element?(view, "#pattern_projects-#{project.id}-block", "Straight skirt")
      assert has_element?(view, "#pattern_projects-#{project.id}-profile", "Me in May")

      assert has_element?(
               view,
               ~s(#pattern_projects-#{project.id} a[href="/patterns/#{project.id}"])
             )

      assert has_element?(
               view,
               ~s(#pattern_projects-#{project.id} a[href="/patterns/#{project.id}/edit"]),
               "Rename"
             )

      refute has_element?(view, "#pattern_projects-#{other.id}")
      refute html =~ "Someone else"
    end

    test "shows a project whose profile was deleted", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      profile = Measurements.get_measurement_profile!(scope, project.measurement_profile_id)
      {:ok, _} = Measurements.delete_measurement_profile(scope, profile)

      {:ok, view, _html} = live(conn, ~p"/patterns")

      assert has_element?(
               view,
               "#pattern_projects-#{project.id}-profile",
               "No measurement profile"
             )
    end

    test "deletes a project from the list", %{conn: conn, scope: scope} do
      project = pattern_project_fixture(scope)
      {:ok, view, _html} = live(conn, ~p"/patterns")

      assert has_element?(
               view,
               ~s(#pattern_projects-#{project.id} button[data-confirm="Delete this pattern?"])
             )

      view
      |> element("#pattern_projects-#{project.id} button", "Delete")
      |> render_click()

      refute has_element?(view, "#pattern_projects-#{project.id}")
      assert has_element?(view, "#patterns-empty")
      assert render(view) =~ "Pattern deleted"
      assert Patterns.list_pattern_projects(scope) == []
    end

    test "cannot delete another user's project", %{conn: conn} do
      other_scope = user_scope_fixture()
      other = pattern_project_fixture(other_scope)
      {:ok, view, _html} = live(conn, ~p"/patterns")

      # The scoped lookup raises Ecto.NoResultsError, which crashes the view.
      Process.flag(:trap_exit, true)

      capture_log(fn ->
        assert {{%Ecto.NoResultsError{}, _}, _} =
                 catch_exit(render_hook(view, "delete", %{"id" => other.id}))
      end)

      assert [_] = Patterns.list_pattern_projects(other_scope)
    end

    test "updates the list when a project changes elsewhere", %{conn: conn, scope: scope} do
      {:ok, view, _html} = live(conn, ~p"/patterns")
      assert has_element?(view, "#patterns-empty")

      project = pattern_project_fixture(scope, name: "From another tab")

      assert has_element?(view, "#pattern_projects-#{project.id}", "From another tab")
    end
  end
end
