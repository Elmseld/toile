defmodule ToileWeb.ErrorHTML do
  @moduledoc """
  This module is invoked by your endpoint in case of errors on HTML requests.

  See config/config.exs.
  """
  use ToileWeb, :html

  # If you want to customize your error pages,
  # uncomment the embed_templates/1 call below
  # and add pages to the error directory:
  #
  #   * lib/toile_web/controllers/error_html/404.html.heex
  #   * lib/toile_web/controllers/error_html/500.html.heex
  #
  # embed_templates "error_html/*"

  # Error pages are plain text. The common ones are translated; any other
  # status falls back to the English text based on the template name, e.g.
  # "403.html" becomes "Forbidden".
  def render("404.html", _assigns), do: gettext("Not Found")
  def render("500.html", _assigns), do: gettext("Internal Server Error")
  def render(template, _assigns), do: Phoenix.Controller.status_message_from_template(template)
end
