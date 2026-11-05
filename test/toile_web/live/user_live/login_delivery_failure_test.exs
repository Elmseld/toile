defmodule ToileWeb.UserLive.LoginDeliveryFailureTest do
  # Not async: swaps the mailer adapter in the application env.
  use ToileWeb.ConnCase, async: false

  import ExUnit.CaptureLog
  import Phoenix.LiveViewTest
  import Swoosh.TestAssertions
  import Toile.AccountsFixtures

  alias Toile.EmailDeliveryHelpers
  alias Toile.FailingMailAdapter

  test "gives the same flash and redirect for a known and an unknown address when the mailer fails" do
    known = user_fixture().email
    FailingMailAdapter.use_failing_mailer()

    {results, log} = with_log(fn -> submit_known_and_unknown(known) end)

    assert [{"/users/log-in", flash}, {"/users/log-in", flash}] = results
    assert flash["info"] =~ "If your email address is registered with us"
    assert log =~ "reason=http_503"
    refute log =~ known
  end

  test "gives the same flash and redirect for a known and an unknown address when the mailer raises" do
    known = user_fixture().email
    FailingMailAdapter.use_raising_mailer()

    {results, log} = with_log(fn -> submit_known_and_unknown(known) end)

    assert [{"/users/log-in", flash}, {"/users/log-in", flash}] = results
    assert flash["info"] =~ "If your email address is registered with us"
    assert log =~ "reason=RuntimeError"
    refute log =~ known
  end

  # Security review S1: a delivery that cannot start must not crash the
  # LiveView (a different reply, and a crash report with the address).
  for {state, make_unavailable, reason} <- [
        {"is down", :stop_delivery_supervisor, ":supervisor_unavailable"},
        {"is full", :fill_delivery_supervisor, ":max_children"}
      ] do
    test "gives the same flash and redirect for a known and an unknown address when the delivery supervisor #{state}" do
      known = user_fixture().email
      apply(EmailDeliveryHelpers, unquote(make_unavailable), [])
      EmailDeliveryHelpers.flush_emails()

      {results, log} = with_log(fn -> submit_known_and_unknown(known) end)

      assert [{"/users/log-in", flash}, {"/users/log-in", flash}] = results
      assert flash["info"] =~ "If your email address is registered with us"
      assert log =~ "Email delivery failed: flow=login_link"
      assert log =~ "reason=#{unquote(reason)}"
      assert log =~ ~s(recipient="u***@example.com")
      refute log =~ known
      refute log =~ "terminating"
      assert_no_email_sent()
    end
  end

  # Submits the magic link form for `known` and for an unknown address, and
  # waits for the background deliveries so their log lines are captured. Each
  # submit comes from its own client IP, so a shared IP budget that is used up
  # cannot keep the delivery from running.
  defp submit_known_and_unknown(known) do
    results =
      for email <- [known, unique_user_email()] do
        conn =
          build_conn_with_unique_peer()

        {:ok, lv, _html} = live(conn, ~p"/users/log-in")

        lv
        |> form("#login_form_magic", user: %{email: email})
        |> render_submit()

        assert_redirect(lv)
      end

    await_email_deliveries()
    results
  end
end
