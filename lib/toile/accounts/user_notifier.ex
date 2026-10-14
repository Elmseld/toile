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
  Deliver instructions to log in with a magic link.
  """
  def deliver_login_instructions(user, url) do
    case user do
      %User{confirmed_at: nil} -> deliver_confirmation_instructions(user, url)
      _ -> deliver_magic_link_instructions(user, url)
    end
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
