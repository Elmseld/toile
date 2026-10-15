defmodule ToileWeb.ErrorHTMLTest do
  use ToileWeb.ConnCase, async: true

  # Bring render_to_string/4 for testing custom views
  import Phoenix.Template, only: [render_to_string: 4]

  test "renders a known status with its message" do
    assert render_to_string(ToileWeb.ErrorHTML, "404", "html", []) == "Not Found"
  end

  test "renders any other status with a generic message" do
    assert render_to_string(ToileWeb.ErrorHTML, "418", "html", []) == "Something went wrong"
  end
end
