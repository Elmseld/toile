defmodule ToileWeb.MeasurementProfileLiveTest do
  use ToileWeb.ConnCase

  import Phoenix.LiveViewTest
  import Toile.MeasurementsFixtures

  @create_attrs %{name: "some name"}
  @update_attrs %{name: "some updated name"}
  @invalid_attrs %{name: nil}

  setup :register_and_log_in_user

  defp create_measurement_profile(%{scope: scope}) do
    measurement_profile = measurement_profile_fixture(scope)

    %{measurement_profile: measurement_profile}
  end

  describe "Index" do
    setup [:create_measurement_profile]

    test "lists all measurement_profiles", %{conn: conn, measurement_profile: measurement_profile} do
      {:ok, _index_live, html} = live(conn, ~p"/measurements")

      assert html =~ "Listing Measurement profiles"
      assert html =~ measurement_profile.name
    end

    test "saves new measurement_profile", %{conn: conn} do
      {:ok, index_live, _html} = live(conn, ~p"/measurements")

      assert {:ok, form_live, _} =
               index_live
               |> element("a", "New Measurement profile")
               |> render_click()
               |> follow_redirect(conn, ~p"/measurements/new")

      assert render(form_live) =~ "New Measurement profile"

      assert form_live
             |> form("#measurement_profile-form", measurement_profile: @invalid_attrs)
             |> render_change() =~ "can&#39;t be blank"

      assert {:ok, index_live, _html} =
               form_live
               |> form("#measurement_profile-form", measurement_profile: @create_attrs)
               |> render_submit()
               |> follow_redirect(conn, ~p"/measurements")

      html = render(index_live)
      assert html =~ "Measurement profile created successfully"
      assert html =~ "some name"
    end

    test "updates measurement_profile in listing", %{
      conn: conn,
      measurement_profile: measurement_profile
    } do
      {:ok, index_live, _html} = live(conn, ~p"/measurements")

      assert {:ok, form_live, _html} =
               index_live
               |> element("#measurement_profiles-#{measurement_profile.id} a", "Edit")
               |> render_click()
               |> follow_redirect(conn, ~p"/measurements/#{measurement_profile}/edit")

      assert render(form_live) =~ "Edit Measurement profile"

      assert form_live
             |> form("#measurement_profile-form", measurement_profile: @invalid_attrs)
             |> render_change() =~ "can&#39;t be blank"

      assert {:ok, index_live, _html} =
               form_live
               |> form("#measurement_profile-form", measurement_profile: @update_attrs)
               |> render_submit()
               |> follow_redirect(conn, ~p"/measurements")

      html = render(index_live)
      assert html =~ "Measurement profile updated successfully"
      assert html =~ "some updated name"
    end

    test "deletes measurement_profile in listing", %{
      conn: conn,
      measurement_profile: measurement_profile
    } do
      {:ok, index_live, _html} = live(conn, ~p"/measurements")

      assert index_live
             |> element("#measurement_profiles-#{measurement_profile.id} a", "Delete")
             |> render_click()

      refute has_element?(index_live, "#measurement_profiles-#{measurement_profile.id}")
    end
  end

  describe "Show" do
    setup [:create_measurement_profile]

    test "displays measurement_profile", %{conn: conn, measurement_profile: measurement_profile} do
      {:ok, _show_live, html} = live(conn, ~p"/measurements/#{measurement_profile}")

      assert html =~ "Show Measurement profile"
      assert html =~ measurement_profile.name
    end

    test "updates measurement_profile and returns to show", %{
      conn: conn,
      measurement_profile: measurement_profile
    } do
      {:ok, show_live, _html} = live(conn, ~p"/measurements/#{measurement_profile}")

      assert {:ok, form_live, _} =
               show_live
               |> element("a", "Edit")
               |> render_click()
               |> follow_redirect(
                 conn,
                 ~p"/measurements/#{measurement_profile}/edit?return_to=show"
               )

      assert render(form_live) =~ "Edit Measurement profile"

      assert form_live
             |> form("#measurement_profile-form", measurement_profile: @invalid_attrs)
             |> render_change() =~ "can&#39;t be blank"

      assert {:ok, show_live, _html} =
               form_live
               |> form("#measurement_profile-form", measurement_profile: @update_attrs)
               |> render_submit()
               |> follow_redirect(conn, ~p"/measurements/#{measurement_profile}")

      html = render(show_live)
      assert html =~ "Measurement profile updated successfully"
      assert html =~ "some updated name"
    end
  end
end
