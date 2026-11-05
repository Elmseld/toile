defmodule ToileWeb.ClientIP do
  @moduledoc """
  Resolves the client IP of a LiveView connection, for the email rate limit
  (ADR 0010).

  By default it is the socket peer address. Behind exactly one reverse proxy
  that appends `X-Forwarded-For`, configure

      config :toile, ToileWeb.ClientIP, source: :x_forwarded_for

  (in production: `TRUST_X_FORWARDED_FOR=true`) to use the rightmost entry of
  the header instead, which is the one that proxy appended. Entries to its left
  are chosen by the client and are never used. An entry may carry a port
  (`203.0.113.7:5678`, `[2001:db8::1]:443`) or brackets (`[2001:db8::1]`);
  these are stripped.

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
  rightmost entry of the last `x-forwarded-for` header, without a port,
  falling back to the peer address if the header is missing or that entry is
  not an IP address.
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
         {:ok, ip} <-
           entry |> strip_port() |> :erlang.binary_to_list() |> :inet.parse_strict_address() do
      ip
    else
      _ -> nil
    end
  end

  defp forwarded_for(_x_headers), do: nil

  # "[v6]" and "[v6]:port" give the v6 address. "v4:port" gives v4: a bare IPv6
  # address never has exactly one colon. Anything else is returned unchanged
  # and left to the parser. Uses `:binary` functions because the header need
  # not be valid UTF-8.
  defp strip_port("[" <> rest = entry) do
    case :binary.split(rest, "]") do
      [host, ""] -> host
      [host, ":" <> port] -> if port?(port), do: host, else: entry
      _ -> entry
    end
  end

  defp strip_port(entry) do
    case :binary.split(entry, ":", [:global]) do
      [host, port] -> if port?(port), do: host, else: entry
      _ -> entry
    end
  end

  defp port?(port), do: port =~ ~r/\A[0-9]{1,5}\z/
end
