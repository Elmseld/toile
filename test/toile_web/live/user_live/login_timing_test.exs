defmodule ToileWeb.UserLive.LoginTimingTest do
  # Not async: swaps the mailer adapter in the application env.
  use ToileWeb.ConnCase, async: false

  import Ecto.Query, only: [from: 2]
  import Phoenix.LiveViewTest
  import Swoosh.TestAssertions
  import Toile.AccountsFixtures

  alias Toile.Accounts
  alias Toile.Accounts.UserToken
  alias Toile.Repo
  alias Toile.SlowMailAdapter

  # Each email takes this long to send. A reply that waited on the mailer
  # would take at least this long; the bound used below is half of it, far
  # above the few milliseconds a reply takes, so the test is not flaky.
  @delay 1_000

  # Ticket 0016: the reply to a login link request must not take longer for an
  # address with an account than for one without.
  setup do
    # user_fixture/0 sends its confirmation email synchronously, so create the
    # user before the slow mailer is swapped in, and drop that email.
    user = user_fixture()
    assert_email_sent()
    SlowMailAdapter.use_slow_mailer(@delay)
    %{user: user}
  end

  test "the reply does not wait on the mailer, for a known or an unknown address", %{user: user} do
    # Warm-up, so the timed submits do not pay for loading code.
    timed_submit(unique_user_email())

    {known_ms, known} = timed_submit(user.email)
    {unknown_ms, unknown} = timed_submit(unique_user_email())

    assert known_ms < div(@delay, 2)
    assert abs(known_ms - unknown_ms) < div(@delay, 2)
    assert known == unknown
    assert {"/users/log-in", %{"info" => "If your email address is registered" <> _}} = known

    await_email_deliveries()
    assert_email_sent(to: user.email, subject: "Log in to Toile")
    assert_no_email_sent()
  end

  test "request_login_instructions/3 returns before the email is sent", %{user: user} do
    {us, :ok} =
      :timer.tc(fn ->
        Accounts.request_login_instructions(user.email, &"http://localhost/users/log-in/#{&1}",
          remote_ip: unique_remote_ip()
        )
      end)

    assert us < @delay * 1_000 / 2

    await_email_deliveries()
    assert_email_sent(to: user.email, subject: "Log in to Toile")
    assert_no_email_sent()

    assert Repo.aggregate(
             from(t in UserToken, where: t.user_id == ^user.id and t.context == "login"),
             :count
           ) == 1
  end

  # Submits the magic link form for `email` from a fresh client IP and returns
  # the time from submit to redirect in ms, with the redirect. Mounting is
  # not timed.
  defp timed_submit(email) do
    conn =
      Plug.Test.put_peer_data(build_conn(), %{
        address: unique_remote_ip(),
        port: 1,
        ssl_cert: nil
      })

    {:ok, lv, _html} = live(conn, ~p"/users/log-in")
    started = System.monotonic_time(:millisecond)

    lv
    |> form("#login_form_magic", user: %{email: email})
    |> render_submit()

    redirect = assert_redirect(lv)
    {System.monotonic_time(:millisecond) - started, redirect}
  end
end
