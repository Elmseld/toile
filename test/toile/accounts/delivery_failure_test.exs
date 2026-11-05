defmodule Toile.Accounts.DeliveryFailureTest do
  # Not async: swaps the mailer adapter in the application env.
  use Toile.DataCase, async: false

  import ExUnit.CaptureLog
  import Toile.AccountsFixtures

  alias Toile.Accounts
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
        end)

      assert log =~ "Email delivery failed: flow=login_link"
      assert log =~ "reason=http_503"
      assert log =~ ~s(recipient="u***@example.com")
      refute log =~ confirmed.email
      refute log =~ unconfirmed.email
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
