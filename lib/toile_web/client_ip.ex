defmodule ToileWeb.ClientIP do
  @moduledoc """
  Resolves the client IP of a LiveView connection, for the email rate limit
  (ADR 0010).

  By default it is the socket peer address. Behind exactly one reverse proxy
  that appends `X-Forwarded-For`, configure

      config :toile, ToileWeb.ClientIP, source: :x_forwarded_for

  (in production: `TRUST_X_FORWARDED_FOR=true`) to use the rightmost entry of
  the header instead, which is the one that proxy appended. Entries to its left
  are chosen by the client and are never used.

  The `/live` socket must declare `:peer_data` and `:x_headers` in its
  `connect_info`.
  """

  import Phoenix.LiveView, only: [get_connect_info: 2]

  @doc """
  Returns the client IP of `socket`, or `nil` if it is unknown. Call it from
  `mount/3`: connect info is only available there.
  """
  @spec get(Phoenix.LiveView.Socket.t()) :: :inet.ip_address() | nil
  def get(socket) do
    source = Application.get_env(:toile, __MODULE__, [])[:source] || :peer

    resolve(get_connect_info(socket, :peer_data), get_connect_info(socket, :x_headers), source)
  end

  @doc """
  Picks the client IP from the peer data and the `x-*` request headers.

  With `:peer` it is the peer address. With `:x_forwarded_for` it is the
  rightmost entry of the last `x-forwarded-for` header, falling back to the
  peer address if the header is missing or that entry is not an IP address.
  """
  @spec resolve(map() | nil, [{String.t(), String.t()}] | nil, :peer | :x_forwarded_for) ::
          :inet.ip_address() | nil
  def resolve(peer_data, x_headers, source)

  def resolve(peer_data, _x_headers, :peer), do: peer_address(peer_data)

  def resolve(peer_data, x_headers, :x_forwarded_for) do
    case forwarded_for(x_headers) do
      nil -> peer_address(peer_data)
      ip -> ip
    end
  end

  defp peer_address(%{address: address}), do: address
  defp peer_address(_peer_data), do: nil

  defp forwarded_for(x_headers) when is_list(x_headers) do
    values = for {"x-forwarded-for", value} <- x_headers, do: value

    with [_ | _] <- values,
         entry = values |> List.last() |> String.split(",") |> List.last() |> String.trim(),
         # Header bytes need not be valid UTF-8, so no String.to_charlist/1.
         {:ok, ip} <- entry |> :erlang.binary_to_list() |> :inet.parse_strict_address() do
      ip
    else
      _ -> nil
    end
  end

  defp forwarded_for(_x_headers), do: nil
end
