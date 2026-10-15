defmodule ToileWeb.UserLive.LoginLocalMailTest do
  # Not async: it changes the application-wide mailer config.
  use ToileWeb.ConnCase, async: false

  import Phoenix.LiveViewTest

  setup do
    original = Application.fetch_env!(:toile, Toile.Mailer)
    on_exit(fn -> Application.put_env(:toile, Toile.Mailer, original) end)
    %{original: original}
  end

  test "shows the local mail notice with the mailbox link", %{
    conn: conn,
    original: original
  } do
    Application.put_env(
      :toile,
      Toile.Mailer,
      Keyword.put(original, :adapter, Swoosh.Adapters.Local)
    )

    {:ok, lv, _html} = live(conn, ~p"/users/log-in")

    assert has_element?(lv, ".alert-info", "You are running the local mail adapter.")
    assert has_element?(lv, ~s(.alert-info a[href="/dev/mailbox"]), "mailbox page")
  end

  test "hides the notice with other adapters", %{conn: conn} do
    {:ok, lv, _html} = live(conn, ~p"/users/log-in")

    refute has_element?(lv, ".alert-info")
  end
end
