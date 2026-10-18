defmodule ToileWeb.Router do
  use ToileWeb, :router

  import ToileWeb.UserAuth

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {ToileWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
    plug :fetch_current_scope_for_user
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", ToileWeb do
    pipe_through :browser

    get "/", PageController, :home
  end

  # Other scopes may use custom stacks.
  # scope "/api", ToileWeb do
  #   pipe_through :api
  # end

  # Enable LiveDashboard and Swoosh mailbox preview in development
  if Application.compile_env(:toile, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: ToileWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end

  ## Authentication routes

  scope "/", ToileWeb do
    pipe_through [:browser, :require_authenticated_user]

    live_session :require_authenticated_user,
      on_mount: [{ToileWeb.UserAuth, :require_authenticated}] do
      live "/patterns", PatternLive.Index, :index
      live "/patterns/new", PatternLive.Form, :new
      live "/patterns/:id", PatternLive.Show, :show
      live "/patterns/:id/edit", PatternLive.Form, :edit
      live "/measurements", MeasurementProfileLive.Index, :index
      live "/measurements/new", MeasurementProfileLive.Form, :new
      live "/measurements/:id", MeasurementProfileLive.Show, :show
      live "/measurements/:id/edit", MeasurementProfileLive.Form, :edit
    end

    post "/users/update-password", UserSessionController, :update_password
  end

  # Account settings need a recent login. The :require_sudo_mode plug checks
  # this on the HTTP request so the path (e.g. an email-change confirmation
  # link) is saved and the user returns to it after logging in again.
  scope "/", ToileWeb do
    pipe_through [:browser, :require_authenticated_user, :require_sudo_mode]

    live_session :require_sudo_mode,
      on_mount: [{ToileWeb.UserAuth, :require_authenticated}] do
      live "/users/settings", UserLive.Settings, :edit
      live "/users/settings/confirm-email/:token", UserLive.Settings, :confirm_email
    end
  end

  scope "/", ToileWeb do
    pipe_through [:browser]

    live_session :current_user,
      on_mount: [{ToileWeb.UserAuth, :mount_current_scope}] do
      live "/users/register", UserLive.Registration, :new
      live "/users/log-in", UserLive.Login, :new
      live "/users/log-in/:token", UserLive.Confirmation, :new
    end

    post "/users/log-in", UserSessionController, :create
    delete "/users/log-out", UserSessionController, :delete
  end
end
