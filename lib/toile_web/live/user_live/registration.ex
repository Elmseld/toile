defmodule ToileWeb.UserLive.Registration do
  use ToileWeb, :live_view

  alias Toile.Accounts
  alias Toile.Accounts.User

  @impl true
  def render(assigns) do
    ~H"""
    <Layouts.app flash={@flash} current_scope={@current_scope}>
      <div class="mx-auto max-w-sm">
        <div class="text-center">
          <.header>
            Skapa ett konto
            <:subtitle>
              Har du redan ett konto?
              <.link navigate={~p"/users/log-in"} class="font-semibold text-brand hover:underline">
                Logga in
              </.link>
              här.
            </:subtitle>
          </.header>
        </div>

        <.form for={@form} id="registration_form" phx-submit="save" phx-change="validate">
          <.input
            field={@form[:email]}
            type="email"
            label="E-post"
            autocomplete="username"
            spellcheck="false"
            required
            phx-mounted={JS.focus()}
          />

          <.button phx-disable-with="Skapar konto..." class="btn btn-primary w-full">
            Skapa konto
          </.button>
        </.form>
      </div>
    </Layouts.app>
    """
  end

  @impl true
  def mount(_params, _session, %{assigns: %{current_scope: %{user: user}}} = socket)
      when not is_nil(user) do
    {:ok, redirect(socket, to: ToileWeb.UserAuth.signed_in_path(socket))}
  end

  def mount(_params, _session, socket) do
    changeset = Accounts.change_user_email(%User{}, %{}, validate_unique: false)

    {:ok, assign_form(socket, changeset), temporary_assigns: [form: nil]}
  end

  @impl true
  def handle_event("save", %{"user" => user_params}, socket) do
    # A taken email gets the same response as a new one so the form does not
    # reveal which addresses have accounts.
    case Accounts.register_user_and_deliver_instructions(
           user_params,
           &url(~p"/users/log-in/#{&1}"),
           url(~p"/users/log-in")
         ) do
      {:ok, email} ->
        {:noreply,
         socket
         |> put_flash(
           :info,
           "Vi har skickat ett mejl till #{email}. Öppna länken i mejlet för att bekräfta ditt konto."
         )
         |> push_navigate(to: ~p"/users/log-in")}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign_form(socket, changeset)}
    end
  end

  def handle_event("validate", %{"user" => user_params}, socket) do
    changeset = Accounts.change_user_email(%User{}, user_params, validate_unique: false)
    {:noreply, assign_form(socket, Map.put(changeset, :action, :validate))}
  end

  defp assign_form(socket, %Ecto.Changeset{} = changeset) do
    form = to_form(changeset, as: "user")
    assign(socket, form: form)
  end
end
