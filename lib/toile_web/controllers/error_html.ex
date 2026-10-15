defmodule ToileWeb.ErrorHTML do
  @moduledoc """
  This module is invoked by your endpoint in case of errors on HTML requests.

  Error pages are plain text in the current locale. The statuses that Plug,
  Phoenix and Phoenix.Ecto can raise as browser-visible errors have their own
  message; any other status gets a generic translated message, so no English
  status text ever reaches the user.

  See config/config.exs.
  """
  use ToileWeb, :html

  def render(template, _assigns) do
    template
    |> String.split(".", parts: 2)
    |> hd()
    |> message()
  end

  # Each clause holds a literal msgid so `mix gettext.extract` picks it up.
  defp message("400"), do: gettext("Bad Request")
  defp message("401"), do: gettext("Unauthorized")
  defp message("403"), do: gettext("Forbidden")
  defp message("404"), do: gettext("Not Found")
  defp message("405"), do: gettext("Method Not Allowed")
  defp message("406"), do: gettext("Not Acceptable")
  defp message("409"), do: gettext("Conflict")
  defp message("413"), do: gettext("Request Entity Too Large")
  defp message("415"), do: gettext("Unsupported Media Type")
  defp message("422"), do: gettext("Unprocessable Entity")
  defp message("500"), do: gettext("Internal Server Error")
  defp message(_status), do: gettext("Something went wrong")
end
