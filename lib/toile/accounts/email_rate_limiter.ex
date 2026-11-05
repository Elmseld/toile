defmodule Toile.Accounts.EmailRateLimiter do
  @moduledoc """
  Caps how many account emails the app sends, per recipient address and per
  client IP (ADR 0010).

  Every email flow calls `hit/4` before sending. A send is allowed only if both
  buckets have room:

    * the recipient bucket: one per flow and address, compared
      case-insensitively like the `citext` column;
    * the IP bucket: one per client IP, shared by all flows. IPv6 addresses are
      counted per /64 prefix and an IPv4-mapped IPv6 address counts as the IPv4
      address. Without an IP (`nil`) this bucket is skipped.

  Both are sliding windows. The limits are read on every call from

      config :toile, Toile.Accounts.EmailRateLimiter,
        per_recipient: [limit: 3, window: :timer.minutes(15)],
        per_ip: [limit: 20, window: :timer.hours(1)]

  (windows in milliseconds).

  The state lives in this one process on this node: a map from bucket key to the
  times of the sends it counts. A send counts while it is younger than the
  window configured at the time of the check, so a changed window applies to
  sends already recorded. Only allowed sends are recorded, so the entries one
  client IP can create are bounded by the IP limit; total memory still grows
  with the number of distinct client IPs (IPv6 /64 prefixes), and calls without
  an IP are bounded by nothing but the per-recipient limit. Addresses are
  stored as SHA-256 hashes, never in clear. A periodic sweep drops expired
  entries, using the configured windows.

  The limiter is fail-open: if the process restarts the counters are lost, and
  while it is unavailable (not running, or not answering within the default
  5 second `GenServer.call/3` timeout) `hit/4` allows the send and logs a
  warning.
  """

  use GenServer

  require Logger

  # Keep in sync with `t:flow/0` below.
  @flows [
    :login_link,
    :registration_confirmation,
    :registration_attempt_notice,
    :email_change_link,
    :email_change_attempt_notice
  ]

  @sweep_interval :timer.minutes(5)

  # Keep in sync with `@flows` above.
  @type flow ::
          :login_link
          | :registration_confirmation
          | :registration_attempt_notice
          | :email_change_link
          | :email_change_attempt_notice

  @doc """
  Starts the limiter. `opts` may give a `:name` (default `#{inspect(__MODULE__)}`).
  """
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, :ok, name: Keyword.get(opts, :name, __MODULE__))
  end

  @doc """
  Records an email of `flow` to `email` requested from `remote_ip`, if both the
  recipient and the IP bucket have room.

  Returns `:ok` if the email may be sent (and counts it), or
  `{:error, :rate_limited}` if either bucket is full, in which case nothing is
  counted and an `info` line with the flow, the full bucket, the IP and a masked
  address is logged.

  Options (mainly for tests):

    * `:server` - the limiter process (default `#{inspect(__MODULE__)}`)
    * `:now` - the current time in monotonic milliseconds
    * `:limits` - the limits, in the format of the application config. The
      periodic sweep always uses the application config.
  """
  @spec hit(flow(), String.t(), :inet.ip_address() | nil, keyword()) ::
          :ok | {:error, :rate_limited}
  def hit(flow, email, remote_ip, opts \\ [])
      when flow in @flows and is_binary(email) and (is_tuple(remote_ip) or is_nil(remote_ip)) do
    limits = Keyword.get_lazy(opts, :limits, fn -> Application.fetch_env!(:toile, __MODULE__) end)
    now = Keyword.get_lazy(opts, :now, fn -> System.monotonic_time(:millisecond) end)
    server = Keyword.get(opts, :server, __MODULE__)

    buckets = [
      {{:recipient, flow, :crypto.hash(:sha256, String.downcase(email))},
       bucket_limits(limits, :per_recipient)}
      | ip_buckets(remote_ip, limits)
    ]

    case call(server, {:hit, buckets, now}) do
      :ok ->
        :ok

      {:deny, bucket} ->
        Logger.info(
          "Email not sent, rate limit reached: flow=#{flow} bucket=#{bucket} " <>
            "recipient=#{inspect(mask(email))} ip=#{format_ip(remote_ip)}"
        )

        {:error, :rate_limited}
    end
  end

  defp ip_buckets(nil, _limits), do: []
  defp ip_buckets(ip, limits), do: [{{:ip, ip_key(ip)}, bucket_limits(limits, :per_ip)}]

  defp bucket_limits(limits, bucket) do
    config = Keyword.fetch!(limits, bucket)
    {Keyword.fetch!(config, :limit), Keyword.fetch!(config, :window)}
  end

  # Tagged so that an IPv6 /64 prefix can never equal an IPv4 address.
  defp ip_key({_, _, _, _} = ipv4), do: {:ipv4, ipv4}

  defp ip_key({0, 0, 0, 0, 0, 0xFFFF, high, low}),
    do: {:ipv4, {div(high, 256), rem(high, 256), div(low, 256), rem(low, 256)}}

  defp ip_key({a, b, c, d, _, _, _, _}), do: {:ipv6_64, {a, b, c, d}}

  # The limiter is fail-open: if it is down (for example while it restarts) the
  # send is allowed rather than failing the request.
  defp call(server, request) do
    GenServer.call(server, request)
  catch
    :exit, reason ->
      # Only the class: the full exit reason contains the request, with the IP
      # and the unsalted address hash.
      Logger.warning("Email rate limiter unavailable, allowing send: #{exit_class(reason)}")
      :ok
  end

  defp exit_class({:noproc, _call}), do: :noproc
  defp exit_class({:timeout, _call}), do: :timeout
  defp exit_class(_reason), do: :other

  # Keeps the first character of the local part and the domain (cut to 100
  # bytes), so a log line hints at the address without revealing it. Both are
  # cut by bytes, since one grapheme can be arbitrarily long.
  defp mask(email) do
    case String.split(email, "@") do
      [_no_at] ->
        "***"

      [local | rest] ->
        domain = rest |> Enum.join("@") |> cut_bytes(100)
        (local |> String.slice(0, 1) |> cut_bytes(8)) <> "***@" <> domain
    end
  end

  # Cuts `string` to at most `max` bytes at a grapheme boundary.
  defp cut_bytes(string, max) do
    string
    |> String.slice(0, max)
    |> String.graphemes()
    |> Enum.reduce_while({"", 0}, fn grapheme, {acc, size} ->
      size = size + byte_size(grapheme)
      if size <= max, do: {:cont, {acc <> grapheme, size}}, else: {:halt, {acc, size}}
    end)
    |> elem(0)
  end

  defp format_ip(nil), do: "none"
  defp format_ip(ip), do: ip |> :inet.ntoa() |> to_string()

  ## Server

  @impl true
  def init(:ok) do
    schedule_sweep()
    {:ok, %{}}
  end

  @impl true
  def handle_call({:hit, buckets, now}, _from, state) do
    current =
      Enum.map(buckets, fn {key, {limit, window}} ->
        {key, limit, live_entries(state, key, now - window)}
      end)

    case Enum.find(current, fn {_key, limit, entries} -> length(entries) >= limit end) do
      nil ->
        state =
          Enum.reduce(current, state, fn {key, _limit, entries}, acc ->
            Map.put(acc, key, [now | entries])
          end)

        {:reply, :ok, state}

      {full_key, _limit, _entries} ->
        state =
          Enum.reduce(current, state, fn {key, _limit, entries}, acc ->
            put_entries(acc, key, entries)
          end)

        {:reply, {:deny, bucket_name(full_key)}, state}
    end
  end

  @impl true
  def handle_info(:sweep, state) do
    now = System.monotonic_time(:millisecond)
    limits = Application.fetch_env!(:toile, __MODULE__)

    cutoffs = %{
      recipient: now - window(limits, :per_recipient),
      ip: now - window(limits, :per_ip)
    }

    state =
      Enum.reduce(state, %{}, fn {key, entries}, acc ->
        cutoff = Map.fetch!(cutoffs, bucket_name(key))
        put_entries(acc, key, Enum.filter(entries, &(&1 > cutoff)))
      end)

    schedule_sweep()
    {:noreply, state}
  end

  # The entries of `key` sent after `cutoff`, that is within the window.
  defp live_entries(state, key, cutoff) do
    state |> Map.get(key, []) |> Enum.filter(&(&1 > cutoff))
  end

  defp window(limits, bucket), do: limits |> bucket_limits(bucket) |> elem(1)

  defp put_entries(state, key, []), do: Map.delete(state, key)
  defp put_entries(state, key, entries), do: Map.put(state, key, entries)

  defp bucket_name({:recipient, _flow, _hash}), do: :recipient
  defp bucket_name({:ip, _ip}), do: :ip

  defp schedule_sweep, do: Process.send_after(self(), :sweep, @sweep_interval)
end
