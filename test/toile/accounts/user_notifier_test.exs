defmodule Toile.Accounts.UserNotifierTest do
  use Toile.DataCase, async: true

  import Toile.AccountsFixtures

  alias Toile.Accounts.UserNotifier

  test "emails use the app default locale, not the caller's, and restore it" do
    user = user_fixture()
    # The test env defaults to "en"; a different locale on the calling process
    # must not reach the email.
    Gettext.put_locale(ToileWeb.Gettext, "sv")

    {:ok, email} = UserNotifier.deliver_login_instructions(user, "http://x/[TOKEN]")

    assert email.subject == "Log in to Toile"
    assert email.text_body =~ "Hi #{user.email},"
    assert email.text_body =~ "http://x/[TOKEN]"
    assert Gettext.get_locale(ToileWeb.Gettext) == "sv"
  end

  test "login instructions for an unconfirmed user are confirmation instructions" do
    user = unconfirmed_user_fixture()

    {:ok, email} = UserNotifier.deliver_login_instructions(user, "http://x/[TOKEN]")

    assert email.to == [{"", user.email}]
    assert email.subject == "Confirm your account on Toile"
    assert email.text_body =~ "http://x/[TOKEN]"
    refute email.text_body =~ "Settings"
  end

  test "login instructions for a confirmed user point to Settings for a new password" do
    user = user_fixture()

    {:ok, email} = UserNotifier.deliver_login_instructions(user, "http://x/[TOKEN]")

    assert email.subject == "Log in to Toile"
    assert email.text_body =~ "password under Settings"
  end

  test "update email, change attempt and registration attempt emails go to the user" do
    user = user_fixture()

    {:ok, update} = UserNotifier.deliver_update_email_instructions(user, "http://x/[TOKEN]")
    assert update.to == [{"", user.email}]
    assert update.text_body =~ "http://x/[TOKEN]"

    {:ok, attempt} = UserNotifier.deliver_email_change_attempt_notice(user)
    assert attempt.to == [{"", user.email}]
    assert attempt.text_body =~ "nothing has changed"
    refute attempt.text_body =~ "http"

    {:ok, reg} = UserNotifier.deliver_registration_attempt_notice(user, "http://x/log-in")
    assert reg.to == [{"", user.email}]
    assert reg.text_body =~ "http://x/log-in"
  end
end
