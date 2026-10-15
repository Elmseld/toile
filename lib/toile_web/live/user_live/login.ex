defmodule ToileWeb.UserLive.Login do
  use ToileWeb, :live_view

  alias Toile.Accounts

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope}>
      <div class="mx-auto max-w-sm space-y-4">
        <div class="text-center">
          <.header>
            <p>Logga in</p>
            <:subtitle>
              <%= if @current_scope do %>
                Du behöver logga in igen för att göra känsliga ändringar i ditt konto.
              <% else %>
                Har du inget konto? <.link
                  navigate={~p"/users/register"}
                  class="font-semibold text-brand hover:underline"
                  phx-no-format
                >Registrera dig</.link> nu.
              <% end %>
            </:subtitle>
          </.header>
        </div>

        <div :if={local_mail_adapter?()} class="alert alert-info">
          <.icon name="hero-information-circle" class="size-6 shrink-0" />
          <div>
            <p>Du kör den lokala mejladaptern.</p>
            <p>
              Skickade mejl finns på <.link href="/dev/mailbox" class="underline">brevlådesidan</.link>.
            </p>
          </div>
        </div>

        <.form
          for={@magic_form}
          id="login_form_magic"
          action={~p"/users/log-in"}
          phx-submit="submit_magic"
        >
          <.input
            readonly={!!@current_scope}
            field={@magic_form[:email]}
            type="email"
            label="E-post"
            autocomplete="username"
            spellcheck="false"
            required
            phx-mounted={JS.focus()}
          />
          <.button class="btn btn-primary w-full">
            Logga in med e-post <span aria-hidden="true">→</span>
          </.button>
        </.form>

        <div class="divider">eller</div>

        <.form
          for={@password_form}
          id="login_form_password"
          action={~p"/users/log-in"}
          phx-submit="submit_password"
          phx-trigger-action={@trigger_submit}
        >
          <.input
            readonly={!!@current_scope}
            field={@password_form[:email]}
            type="email"
            label="E-post"
            autocomplete="username"
            spellcheck="false"
            required
          />
          <.input
            field={@password_form[:password]}
            type="password"
            label="Lösenord"
            autocomplete="current-password"
            spellcheck="false"
          />
          <.button
            class="btn btn-primary w-full"
            name={@password_form[:remember_me].name}
            value="true"
          >
            Logga in och förbli inloggad <span aria-hidden="true">→</span>
          </.button>
          <.button class="btn btn-primary btn-soft w-full mt-2">
            Logga in bara den här gången
          </.button>
        </.form>

        <p id="forgot-password-hint" class="text-sm text-base-content/70">
          Glömt lösenordet? Ange din e-post ovan och välj 'Logga in med e-post'. När du är
          inloggad kan du välja ett nytt lösenord under Inställningar.
        </p>
      </div>
    </Layouts.app>
    """
  end

  @impl true
  def mount(_params, _session, socket) do
    email =
      Phoenix.Flash.get(socket.assigns.flash, :email) ||
        get_in(socket.assigns, [:current_scope, Access.key(:user), Access.key(:email)])

    params = %{"email" => email}

    {:ok,
     assign(socket,
       magic_form: to_form(params, as: "user", id: "login_form_magic"),
       password_form: to_form(params, as: "user", id: "login_form_password"),
       trigger_submit: false
     )}
  end

  @impl true
  def handle_event("submit_password", _params, socket) do
    {:noreply, assign(socket, :trigger_submit, true)}
  end

  def handle_event("submit_magic", %{"user" => %{"email" => email}}, socket) do
    if user = Accounts.get_user_by_email(email) do
      Accounts.deliver_login_instructions(
        user,
        &url(~p"/users/log-in/#{&1}")
      )
    end

    info =
      "Om din e-postadress finns hos oss får du snart ett mejl med instruktioner för att logga in."

    {:noreply,
     socket
     |> put_flash(:info, info)
     |> push_navigate(to: ~p"/users/log-in")}
  end

  defp local_mail_adapter? do
    Application.get_env(:toile, Toile.Mailer)[:adapter] == Swoosh.Adapters.Local
  end
end
