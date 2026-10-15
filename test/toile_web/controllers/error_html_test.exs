defmodule ToileWeb.ErrorHTMLTest do
  use ToileWeb.ConnCase, async: true

  # Bring render_to_string/4 for testing custom views
  import Phoenix.Template, only: [render_to_string: 4]

  for {status, message} <- [
        {"400", "Ogiltig begäran"},
        {"401", "Inloggning krävs"},
        {"403", "Åtkomst nekad"},
        {"404", "Sidan hittades inte"},
        {"405", "Metoden är inte tillåten"},
        {"406", "Formatet stöds inte"},
        {"409", "Konflikt"},
        {"413", "Förfrågan är för stor"},
        {"415", "Filtypen stöds inte"},
        {"422", "Förfrågan kunde inte behandlas"},
        {"500", "Internt serverfel"}
      ] do
    test "renders #{status}.html in Swedish" do
      assert render_to_string(ToileWeb.ErrorHTML, unquote(status), "html", []) ==
               unquote(message)
    end
  end

  test "renders any other status with a generic Swedish message" do
    assert render_to_string(ToileWeb.ErrorHTML, "418", "html", []) == "Något gick fel"
    assert render_to_string(ToileWeb.ErrorHTML, "503", "html", []) == "Något gick fel"
  end
end
