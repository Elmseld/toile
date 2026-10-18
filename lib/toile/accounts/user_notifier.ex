defmodule Toile.Accounts.UserNotifier do
  use Gettext, backend: ToileWeb.Gettext

  import Swoosh.Email

  alias Toile.Mailer
  alias Toile.Accounts.User

  # Emails go to the account owner and there is no per-user language yet, so
  # they always use the app default locale. Pinning it keeps a locale set on
  # the calling process from leaking into an email to someone else. The default
  # is read at send time because it comes from DEFAULT_LOCALE at runtime.

  # Delivers the email using the application mailer.
  defp deliver(recipient, subject, body) do
    email =
      new()
      |> to(recipient)
      |> from({"Toile", "contact@example.com"})
      |> subject(subject)
      |> text_body(
        "\n==============================\n\n" <> body <> "\n==============================\n"
      )

    with {:ok, _metadata} <- Mailer.deliver(email) do
      {:ok, email}
    end
  end

  defp in_email_locale(fun) do
    Gettext.with_locale(ToileWeb.Gettext, Application.fetch_env!(:gettext, :default_locale), fun)
  end

  @doc """
  Deliver instructions to update a user email.
  """
  def deliver_update_email_instructions(user, url) do
    in_email_locale(fn ->
      deliver(
        user.email,
        gettext("Change your email address for Toile"),
        gettext(
          """
          Hi %{email},

          You can change your email address by visiting the link below:

          %{url}

          If you didn't request this change, please ignore this email.
          """,
          email: user.email,
          url: url
        )
      )
    end)
  end

  @doc """
  Deliver a notice that another account tried to change its email address to
  this user's address. Nothing about this user's account changes.
  """
  def deliver_email_change_attempt_notice(user) do
    in_email_locale(fn ->
      deliver(
        user.email,
        gettext("Someone tried to use your email address on Toile"),
        gettext(
          """
          Hi %{email},

          Someone just tried to change the email address of another Toile account to your
          address. Since the address already belongs to your account, nothing has changed.

          If this wasn't you, you can ignore this email. Your account is unchanged.
          """,
          email: user.email
        )
      )
    end)
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
    in_email_locale(fn ->
      deliver(
        user.email,
        gettext("Someone tried to create an account on Toile"),
        gettext(
          """
          Hi %{email},

          Someone just tried to create a new account on Toile with your email address.
          You already have an account with us and can log in here:

          %{url}

          If this wasn't you, you can ignore this email. Your account is unchanged.
          """,
          email: user.email,
          url: login_url
        )
      )
    end)
  end

  defp deliver_magic_link_instructions(user, url) do
    in_email_locale(fn ->
      deliver(
        user.email,
        gettext("Log in to Toile"),
        gettext(
          """
          Hi %{email},

          You can log into your account by visiting the link below:

          %{url}

          Forgot your password? Once you are logged in, you can choose a new
          password under Settings.

          If you didn't request this email, please ignore it.
          """,
          email: user.email,
          url: url
        )
      )
    end)
  end

  defp deliver_confirmation_instructions(user, url) do
    in_email_locale(fn ->
      deliver(
        user.email,
        gettext("Confirm your account on Toile"),
        gettext(
          """
          Hi %{email},

          You can confirm your account by visiting the link below:

          %{url}

          If you didn't create an account with us, please ignore this email.
          """,
          email: user.email,
          url: url
        )
      )
    end)
  end
end
