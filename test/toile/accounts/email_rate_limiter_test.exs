defmodule Toile.Accounts.EmailRateLimiterTest do
  use ExUnit.Case, async: true

  alias Toile.Accounts.EmailRateLimiter

  @window 60_000
  @ip_window 120_000
  @limits [
    per_recipient: [limit: 3, window: @window],
    per_ip: [limit: 20, window: @ip_window]
  ]
  @ip {10, 0, 0, 1}

  setup do
    server = :"email_rate_limiter_#{System.unique_integer([:positive])}"
    pid = start_supervised!({EmailRateLimiter, name: server})
    %{server: server, pid: pid}
  end

  defp hit(server, flow, email, ip, now \\ 0) do
    EmailRateLimiter.hit(flow, email, ip, server: server, now: now, limits: @limits)
  end

  defp hits(server, n, flow, email_fun, ip, now \\ 0) do
    for i <- 1..n, do: hit(server, flow, email_fun.(i), ip, now)
  end

  describe "recipient bucket" do
    test "allows 3 emails per flow and address, then denies", %{server: server} do
      assert hits(server, 3, :login_link, fn _ -> "a@example.com" end, nil) == [:ok, :ok, :ok]
      assert hit(server, :login_link, "a@example.com", nil) == {:error, :rate_limited}
    end

    test "counts each flow separately", %{server: server} do
      hits(server, 3, :login_link, fn _ -> "a@example.com" end, nil)

      assert hit(server, :registration_confirmation, "a@example.com", nil) == :ok
      assert hit(server, :email_change_link, "a@example.com", nil) == :ok
    end

    test "compares addresses case-insensitively", %{server: server} do
      assert hit(server, :login_link, "A@Example.com", nil) == :ok
      assert hit(server, :login_link, "a@example.COM", nil) == :ok
      assert hit(server, :login_link, "a@example.com", nil) == :ok
      assert hit(server, :login_link, "A@EXAMPLE.COM", nil) == {:error, :rate_limited}
    end

    test "is a sliding window", %{server: server} do
      assert hit(server, :login_link, "a@example.com", nil, 0) == :ok
      assert hit(server, :login_link, "a@example.com", nil, 1_000) == :ok
      assert hit(server, :login_link, "a@example.com", nil, 2_000) == :ok

      assert hit(server, :login_link, "a@example.com", nil, @window - 1) ==
               {:error, :rate_limited}

      assert hit(server, :login_link, "a@example.com", nil, @window) == :ok

      # The second and third hits are still inside the window.
      assert hit(server, :login_link, "a@example.com", nil, @window + 999) ==
               {:error, :rate_limited}

      assert hit(server, :login_link, "a@example.com", nil, @window + 1_000) == :ok
    end

    test "a denied recipient uses no IP budget", %{server: server} do
      hits(server, 3, :login_link, fn _ -> "a@example.com" end, @ip)

      for _ <- 1..10 do
        assert hit(server, :login_link, "a@example.com", @ip) == {:error, :rate_limited}
      end

      assert hits(server, 17, :login_link, &"other#{&1}@example.com", @ip) ==
               List.duplicate(:ok, 17)

      assert hit(server, :login_link, "last@example.com", @ip) == {:error, :rate_limited}
    end
  end

  describe "IP bucket" do
    test "allows 20 emails per IP across addresses and flows, then denies", %{server: server} do
      assert hits(server, 10, :login_link, &"a#{&1}@example.com", @ip) == List.duplicate(:ok, 10)

      assert hits(server, 10, :registration_attempt_notice, &"b#{&1}@example.com", @ip) ==
               List.duplicate(:ok, 10)

      assert hit(server, :email_change_link, "c@example.com", @ip) == {:error, :rate_limited}
      assert hit(server, :email_change_link, "c@example.com", {10, 0, 0, 2}) == :ok
    end

    test "is a sliding window", %{server: server} do
      hits(server, 20, :login_link, &"a#{&1}@example.com", @ip, 0)

      assert hit(server, :login_link, "b@example.com", @ip, @ip_window - 1) ==
               {:error, :rate_limited}

      assert hit(server, :login_link, "b@example.com", @ip, @ip_window) == :ok
    end

    test "a denied IP records no recipient hit", %{server: server} do
      hits(server, 20, :login_link, &"a#{&1}@example.com", @ip)

      for _ <- 1..5 do
        assert hit(server, :login_link, "victim@example.com", @ip) == {:error, :rate_limited}
      end

      assert hits(server, 3, :login_link, fn _ -> "victim@example.com" end, {10, 0, 0, 2}) ==
               [:ok, :ok, :ok]
    end

    test "counts IPv6 addresses per /64 prefix", %{server: server} do
      hits(server, 20, :login_link, &"a#{&1}@example.com", {0x2001, 0xDB8, 1, 2, 0, 0, 0, 1})

      assert hit(server, :login_link, "b@example.com", {0x2001, 0xDB8, 1, 2, 9, 9, 9, 9}) ==
               {:error, :rate_limited}

      assert hit(server, :login_link, "b@example.com", {0x2001, 0xDB8, 1, 3, 0, 0, 0, 1}) == :ok
    end

    test "counts an IPv4-mapped IPv6 address as the IPv4 address", %{server: server} do
      hits(server, 20, :login_link, &"a#{&1}@example.com", {192, 0, 2, 1})

      assert hit(server, :login_link, "b@example.com", {0, 0, 0, 0, 0, 0xFFFF, 0xC000, 0x0201}) ==
               {:error, :rate_limited}
    end

    test "does not confuse an IPv6 prefix with an IPv4 address", %{server: server} do
      hits(server, 20, :login_link, &"a#{&1}@example.com", {1, 2, 3, 4})

      assert hit(server, :login_link, "b@example.com", {1, 2, 3, 4, 0, 0, 0, 1}) == :ok
    end

    test "is skipped without an IP", %{server: server} do
      assert hits(server, 30, :login_link, &"a#{&1}@example.com", nil) == List.duplicate(:ok, 30)
    end
  end

  test "the sweep drops entries older than the configured windows", %{server: server, pid: pid} do
    now = System.monotonic_time(:millisecond)

    # The sweep uses the application config (1 hour per IP), not the test limits.
    assert hit(server, :login_link, "old@example.com", @ip, now - :timer.hours(2)) == :ok
    assert hit(server, :login_link, "new@example.com", {10, 0, 0, 2}, now) == :ok
    assert map_size(:sys.get_state(pid)) == 4

    send(pid, :sweep)
    state = :sys.get_state(pid)

    assert map_size(state) == 2
    assert Map.has_key?(state, {:ip, {:ipv4, {10, 0, 0, 2}}})
    refute Map.has_key?(state, {:ip, {:ipv4, @ip}})
  end

  test "does not keep addresses in clear", %{server: server, pid: pid} do
    hit(server, :login_link, "secret@example.com", nil)

    refute inspect(:sys.get_state(pid), limit: :infinity) =~ "secret"
  end

  test "allows the send when the limiter is not running" do
    log =
      ExUnit.CaptureLog.capture_log(fn ->
        assert EmailRateLimiter.hit(:login_link, "a@example.com", nil,
                 server: :no_such_limiter,
                 limits: @limits
               ) == :ok
      end)

    assert log =~ "Email rate limiter unavailable, allowing send: noproc"
  end

  test "logs neither the IP nor the address hash when the limiter is unavailable" do
    email = "hidden@example.com"
    hash = :crypto.hash(:sha256, email)

    log =
      ExUnit.CaptureLog.capture_log(fn ->
        assert EmailRateLimiter.hit(:login_link, email, {203, 0, 113, 99},
                 server: :no_such_limiter,
                 limits: @limits
               ) == :ok
      end)

    assert log =~ "noproc"
    refute log =~ "203"
    refute log =~ "<<"
    refute log =~ inspect(hash)
    refute log =~ Base.encode16(hash, case: :lower)
    refute log =~ "hidden"
  end
end
