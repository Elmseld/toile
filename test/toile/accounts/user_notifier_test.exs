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
end
