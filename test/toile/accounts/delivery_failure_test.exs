defmodule Toile.Accounts.DeliveryFailureTest do
  # Not async: swaps the mailer adapter in the application env.
  use Toile.DataCase, async: false

  import ExUnit.CaptureLog
  import Swoosh.TestAssertions
  import Toile.AccountsFixtures

  alias Toile.Accounts
  alias Toile.EmailDeliveryHelpers
  alias Toile.FailingMailAdapter

  @login_url "http://localhost/users/log-in"

  # Copilot finding C4480733798: a raise on a failed send would answer only
  # requests for addresses with an account differently, revealing them.
  setup do
    %{confirmed: user_fixture(), unconfirmed: unconfirmed_user_fixture()}
  end

  describe "request_login_instructions/3 with a failing mailer" do
    test "returns :ok for confirmed, unconfirmed and unknown addresses", %{
      confirmed: confirmed,
      unconfirmed: unconfirmed
    } do
      FailingMailAdapter.use_failing_mailer()

      log =
        capture_log(fn ->
          for email <- [confirmed.email, unconfirmed.email, unique_user_email()] do
            assert Accounts.request_login_instructions(email, &"#{@login_url}/#{&1}",
                     remote_ip: unique_remote_ip()
                   ) == :ok
          end

          await_email_deliveries()
        end)

      assert log =~ "Email delivery failed: flow=login_link"
      assert log =~ "reason=http_503"
      assert log =~ ~s(recipient="u***@example.com")
      refute log =~ confirmed.email
      refute log =~ unconfirmed.email
    end

    for {failure, swap_in, reason} <- [
          {"raise", :use_raising_mailer, "RuntimeError"},
          {"exit", :use_exiting_mailer, ":exit"}
        ] do
      test "logs a mailer #{failure} without the address and answers :ok", %{
        confirmed: confirmed
      } do
        apply(FailingMailAdapter, unquote(swap_in), [])

        {result, log} =
          with_log(fn ->
            result =
              Accounts.request_login_instructions(confirmed.email, &"#{@login_url}/#{&1}",
                remote_ip: unique_remote_ip()
              )

            await_email_deliveries()
            result
          end)

        assert result == :ok
        assert log =~ "Email delivery failed: flow=login_link"
        assert log =~ "reason=#{unquote(reason)}"
        refute log =~ confirmed.email
        # The task ended normally, without a crash report.
        refute log =~ "terminating"
      end
    end
  end

  # Security review S1 and performance review P1: a delivery that cannot be
  # started is logged like a failed one, without the address, and not raised.
  describe "request_login_instructions/3 when no delivery can be started" do
    for {state, make_unavailable, reason} <- [
          {"is down", :stop_delivery_supervisor, ":supervisor_unavailable"},
          {"is full", :fill_delivery_supervisor, ":max_children"}
        ] do
      test "returns :ok and logs the masked address when the supervisor #{state}", %{
        confirmed: confirmed
      } do
        apply(EmailDeliveryHelpers, unquote(make_unavailable), [])
        EmailDeliveryHelpers.flush_emails()
        unknown = unique_user_email()

        log =
          capture_log(fn ->
            for email <- [confirmed.email, unknown] do
              assert Accounts.request_login_instructions(email, &"#{@login_url}/#{&1}",
                       remote_ip: unique_remote_ip()
                     ) == :ok
            end
          end)

        lines = log |> String.split("\n") |> Enum.filter(&(&1 =~ "flow=login_link"))
        assert length(lines) == 2
        assert Enum.all?(lines, &(&1 =~ "reason=#{unquote(reason)}"))
        assert log =~ ~s(recipient="u***@example.com")
        refute log =~ confirmed.email
        refute log =~ unknown
        assert_no_email_sent()

        assert Repo.aggregate(
                 from(t in Toile.Accounts.UserToken,
                   where: t.user_id == ^confirmed.id and t.context == "login"
                 ),
                 :count
               ) == 0
      end
    end
  end

  describe "register_user_and_deliver_instructions/4 with a failing mailer" do
    test "returns {:ok, email} for a free and a taken address", %{confirmed: confirmed} do
      FailingMailAdapter.use_failing_mailer()
      free = unique_user_email()

      log =
        capture_log(fn ->
          for email <- [free, confirmed.email] do
            assert Accounts.register_user_and_deliver_instructions(
                     %{email: email},
                     &"#{@login_url}/#{&1}",
                     @login_url,
                     remote_ip: unique_remote_ip()
                   ) == {:ok, email}
          end
        end)

      assert log =~ "flow=registration_confirmation"
      assert log =~ "flow=registration_attempt_notice"
      assert Accounts.get_user_by_email(free)
    end
  end

  describe "request_user_email_change/4 with a failing mailer" do
    test "returns {:ok, email} for a free and a taken address", %{
      confirmed: confirmed,
      unconfirmed: unconfirmed
    } do
      FailingMailAdapter.use_failing_mailer()
      free = unique_user_email()

      log =
        capture_log(fn ->
          for email <- [free, unconfirmed.email] do
            assert Accounts.request_user_email_change(
                     confirmed,
                     %{email: email},
                     &"http://localhost/users/settings/confirm-email/#{&1}",
                     remote_ip: unique_remote_ip()
                   ) == {:ok, email}
          end
        end)

      assert log =~ "flow=email_change_link"
      assert log =~ "flow=email_change_attempt_notice"
    end
  end
end
