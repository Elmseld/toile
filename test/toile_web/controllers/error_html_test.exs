defmodule ToileWeb.ErrorHTMLTest do
  use ToileWeb.ConnCase, async: true

  # Bring render_to_string/4 for testing custom views
  import Phoenix.Template, only: [render_to_string: 4]

  test "renders 404.html" do
    assert render_to_string(ToileWeb.ErrorHTML, "404", "html", []) == "Sidan hittades inte"
  end

  test "renders 500.html" do
    assert render_to_string(ToileWeb.ErrorHTML, "500", "html", []) == "Internt serverfel"
  end

  test "renders other statuses with the default status message" do
    assert render_to_string(ToileWeb.ErrorHTML, "403", "html", []) == "Forbidden"
  end
end
