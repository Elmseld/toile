defmodule Toile.Accounts.UserNotifierTest do
  use Toile.DataCase, async: true

  import Toile.AccountsFixtures

  alias Toile.Accounts.UserNotifier

  @frame "=============================="

  setup do
    # A locale set on the calling process must not reach the email.
    Gettext.put_locale(ToileWeb.Gettext, "en")
    %{user: user_fixture()}
  end

  test "login instructions are sent in Swedish", %{user: user} do
    {:ok, email} = UserNotifier.deliver_login_instructions(user, "http://x/[TOKEN]")

    assert email.subject == "Logga in på Toile"

    assert email.text_body == """

           #{@frame}

           Hej #{user.email},

           Du kan logga in på ditt konto genom att öppna länken nedan:

           http://x/[TOKEN]

           Har du glömt ditt lösenord? När du är inloggad kan du välja ett nytt
           lösenord under Inställningar.

           Om du inte har bett om det här mejlet kan du bortse från det.

           #{@frame}
           """

    refute email.text_body =~ "Hi "
    assert Gettext.get_locale(ToileWeb.Gettext) == "en"
  end

  test "confirmation instructions are sent in Swedish" do
    user = unconfirmed_user_fixture()

    {:ok, email} = UserNotifier.deliver_login_instructions(user, "http://x/[TOKEN]")

    assert email.subject == "Bekräfta ditt konto på Toile"
    assert email.text_body =~ "Hej #{user.email},"
    assert email.text_body =~ "Du kan bekräfta ditt konto"
    refute email.text_body =~ "Hi "
  end

  test "update email instructions are sent in Swedish", %{user: user} do
    {:ok, email} = UserNotifier.deliver_update_email_instructions(user, "http://x/[TOKEN]")

    assert email.subject == "Ändra e-postadress för Toile"
    assert email.text_body =~ "Hej #{user.email},"
    assert email.text_body =~ "Du kan ändra din e-postadress"
    assert email.text_body =~ "http://x/[TOKEN]"
    assert email.text_body =~ @frame
    refute email.text_body =~ "Hi "
  end

  test "email change attempt notice is sent in Swedish", %{user: user} do
    {:ok, email} = UserNotifier.deliver_email_change_attempt_notice(user)

    assert email.subject == "Någon försökte använda din e-postadress på Toile"
    assert email.text_body =~ "Hej #{user.email},"
    assert email.text_body =~ "Ditt konto är oförändrat."
    refute email.text_body =~ "Hi "
  end

  test "registration attempt notice is sent in Swedish", %{user: user} do
    {:ok, email} = UserNotifier.deliver_registration_attempt_notice(user, "http://x/log-in")

    assert email.subject == "Någon försökte skapa ett konto på Toile"
    assert email.text_body =~ "Hej #{user.email},"
    assert email.text_body =~ "kan logga in här:\n\nhttp://x/log-in\n"
    refute email.text_body =~ "Hi "
  end
end
