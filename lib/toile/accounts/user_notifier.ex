defmodule Toile.Accounts.UserNotifier do
  import Swoosh.Email

  alias Toile.Mailer
  alias Toile.Accounts.User

  # Delivers the email using the application mailer.
  defp deliver(recipient, subject, body) do
    email =
      new()
      |> to(recipient)
      |> from({"Toile", "contact@example.com"})
      |> subject(subject)
      |> text_body(body)

    with {:ok, _metadata} <- Mailer.deliver(email) do
      {:ok, email}
    end
  end

  @doc """
  Deliver instructions to update a user email.
  """
  def deliver_update_email_instructions(user, url) do
    deliver(user.email, "Ändra e-postadress för Toile", """

    ==============================

    Hej #{user.email},

    Du kan ändra din e-postadress genom att öppna länken nedan:

    #{url}

    Om du inte har bett om den här ändringen kan du bortse från mejlet.

    ==============================
    """)
  end

  @doc """
  Deliver a notice that another account tried to change its email address to
  this user's address. Nothing about this user's account changes.
  """
  def deliver_email_change_attempt_notice(user) do
    deliver(user.email, "Någon försökte använda din e-postadress på Toile", """

    ==============================

    Hej #{user.email},

    Någon försökte nyss byta e-postadressen på ett annat Toile-konto till din
    adress. Eftersom adressen redan hör till ditt konto har ingenting ändrats.

    Om det inte var du kan du bortse från mejlet. Ditt konto är oförändrat.

    ==============================
    """)
  end

  @doc """
  Deliver instructions to log in with a magic link.
  """
  def deliver_login_instructions(user, url) do
    case user do
      %User{confirmed_at: nil} -> deliver_confirmation_instructions(user, url)
      _ -> deliver_magic_link_instructions(user, url)
    end
  end

  @doc """
  Deliver a notice that someone tried to register with an email address that
  already has an account, with a link to the login page.
  """
  def deliver_registration_attempt_notice(user, login_url) do
    deliver(user.email, "Någon försökte skapa ett konto på Toile", """

    ==============================

    Hej #{user.email},

    Någon försökte nyss skapa ett nytt konto på Toile med din e-postadress.
    Du har redan ett konto hos oss och kan logga in här:

    #{login_url}

    Om det inte var du kan du bortse från mejlet. Ditt konto är oförändrat.

    ==============================
    """)
  end

  defp deliver_magic_link_instructions(user, url) do
    deliver(user.email, "Logga in på Toile", """

    ==============================

    Hej #{user.email},

    Du kan logga in på ditt konto genom att öppna länken nedan:

    #{url}

    Har du glömt ditt lösenord? När du är inloggad kan du välja ett nytt
    lösenord under Inställningar.

    Om du inte har bett om det här mejlet kan du bortse från det.

    ==============================
    """)
  end

  defp deliver_confirmation_instructions(user, url) do
    deliver(user.email, "Bekräfta ditt konto på Toile", """

    ==============================

    Hej #{user.email},

    Du kan bekräfta ditt konto genom att öppna länken nedan:

    #{url}

    Om du inte har skapat ett konto hos oss kan du bortse från mejlet.

    ==============================
    """)
  end
end
