defmodule ToileWeb.Layouts do
  @moduledoc """
  This module holds layouts and related functionality
  used by your application.
  """
  use ToileWeb, :html

  # Embed all files in layouts/* within this module.
  # The default root.html.heex file contains the HTML
  # skeleton of your application, namely HTML headers
  # and other static content.
  embed_templates "layouts/*"

  @doc """
  Renders the app layout with the Toile header.

  The header shows "Mina mönster", "Mått", "Inställningar" and "Logga ut" when
  `@current_scope` holds a user, and "Logga in" and "Registrera" otherwise.
  Pass `current_scope` from every page so the header matches the session.

  The content column is `max-w-2xl`, sized for forms and lists. Pass `wide` for pages that
  need the screen width, such as the pattern drawing; it widens the column to `max-w-7xl`.

  ## Examples

      <Layouts.app flash={@flash} current_scope={@current_scope}>
        <h1>Content</h1>
      </Layouts.app>

      <Layouts.app flash={@flash} current_scope={@current_scope} wide>
        <div id="drawing">...</div>
      </Layouts.app>

  """
  attr :flash, :map, required: true, doc: "the map of flash messages"

  attr :current_scope, :map,
    default: nil,
    doc: "the current [scope](https://hexdocs.pm/phoenix/scopes.html)"

  attr :wide, :boolean, default: false, doc: "widens the content column for drawings"

  slot :inner_block, required: true

  def app(assigns) do
    ~H"""
    <header class="navbar border-b border-base-300 px-4 sm:px-6 lg:px-8">
      <div class="flex-1">
        <.link
          id="nav-home"
          href={~p"/"}
          class="flex w-fit items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <.icon name="hero-scissors" class="size-5 text-primary" /> Toile
        </.link>
      </div>
      <nav class="min-w-0 flex-initial" aria-label={gettext("Main menu")}>
        <ul class="flex flex-wrap items-center justify-end gap-2 px-1 sm:gap-4">
          <%= if @current_scope && @current_scope.user do %>
            <li>
              <.link id="nav-my-patterns" navigate={~p"/patterns"} class="btn btn-ghost btn-sm">
                {gettext("My patterns")}
              </.link>
            </li>
            <li>
              <.link id="nav-measurements" navigate={~p"/measurements"} class="btn btn-ghost btn-sm">
                {gettext("Measurements")}
              </.link>
            </li>
            <li
              id="nav-user-email"
              class="hidden max-w-56 truncate text-sm text-base-content/70 lg:block"
              title={@current_scope.user.email}
            >
              {@current_scope.user.email}
            </li>
            <li>
              <.link id="nav-settings" navigate={~p"/users/settings"} class="btn btn-ghost btn-sm">
                {gettext("Settings")}
              </.link>
            </li>
            <li>
              <.link
                id="nav-log-out"
                href={~p"/users/log-out"}
                method="delete"
                class="btn btn-ghost btn-sm"
              >
                {gettext("Log out")}
              </.link>
            </li>
          <% else %>
            <li>
              <.link id="nav-log-in" navigate={~p"/users/log-in"} class="btn btn-ghost btn-sm">
                {gettext("Log in")}
              </.link>
            </li>
            <li>
              <.link id="nav-register" navigate={~p"/users/register"} class="btn btn-primary btn-sm">
                {gettext("Register")}
              </.link>
            </li>
          <% end %>
          <li>
            <.theme_toggle />
          </li>
        </ul>
      </nav>
    </header>

    <main class="px-4 py-20 sm:px-6 lg:px-8">
      <div id="main-content" class={["mx-auto space-y-4", (@wide && "max-w-7xl") || "max-w-2xl"]}>
        {render_slot(@inner_block)}
      </div>
    </main>

    <.flash_group flash={@flash} />
    """
  end

  @doc """
  Shows the flash group with standard titles and content.

  ## Examples

      <.flash_group flash={@flash} />
  """
  attr :flash, :map, required: true, doc: "the map of flash messages"
  attr :id, :string, default: "flash-group", doc: "the optional id of flash container"

  def flash_group(assigns) do
    ~H"""
    <div id={@id} aria-live="polite">
      <.flash kind={:info} flash={@flash} />
      <.flash kind={:error} flash={@flash} />

      <.flash
        id="client-error"
        kind={:error}
        title={gettext("We can't find the internet")}
        phx-disconnected={show(".phx-client-error #client-error") |> JS.remove_attribute("hidden")}
        phx-connected={hide("#client-error") |> JS.set_attribute({"hidden", ""})}
        hidden
      >
        {gettext("Attempting to reconnect")}
        <.icon name="hero-arrow-path" class="ml-1 size-3 motion-safe:animate-spin" />
      </.flash>

      <.flash
        id="server-error"
        kind={:error}
        title={gettext("Something went wrong!")}
        phx-disconnected={show(".phx-server-error #server-error") |> JS.remove_attribute("hidden")}
        phx-connected={hide("#server-error") |> JS.set_attribute({"hidden", ""})}
        hidden
      >
        {gettext("Attempting to reconnect")}
        <.icon name="hero-arrow-path" class="ml-1 size-3 motion-safe:animate-spin" />
      </.flash>
    </div>
    """
  end

  @doc """
  Provides dark vs light theme toggle based on themes defined in app.css.

  See <head> in root.html.heex which applies the theme before page load.
  """
  def theme_toggle(assigns) do
    ~H"""
    <div class="card relative flex flex-row items-center border-2 border-base-300 bg-base-300 rounded-full">
      <div class="absolute w-1/3 h-full rounded-full border-1 border-base-200 bg-base-100 brightness-200 left-0 [[data-theme=light]_&]:left-1/3 [[data-theme=dark]_&]:left-2/3 transition-[left]" />

      <button
        class="flex p-2 cursor-pointer w-1/3"
        phx-click={JS.dispatch("phx:set-theme")}
        data-phx-theme="system"
        aria-label={gettext("System theme")}
      >
        <.icon name="hero-computer-desktop-micro" class="size-4 opacity-75 hover:opacity-100" />
      </button>

      <button
        class="flex p-2 cursor-pointer w-1/3"
        phx-click={JS.dispatch("phx:set-theme")}
        data-phx-theme="light"
        aria-label={gettext("Light theme")}
      >
        <.icon name="hero-sun-micro" class="size-4 opacity-75 hover:opacity-100" />
      </button>

      <button
        class="flex p-2 cursor-pointer w-1/3"
        phx-click={JS.dispatch("phx:set-theme")}
        data-phx-theme="dark"
        aria-label={gettext("Dark theme")}
      >
        <.icon name="hero-moon-micro" class="size-4 opacity-75 hover:opacity-100" />
      </button>
    </div>
    """
  end
end
