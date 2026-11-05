defmodule Toile.Accounts.EmailRateLimiterLogTest do
  # Not async: raising the log level of `EmailRateLimiter` is global, so no other test may log
  # through it meanwhile.
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias Toile.Accounts.EmailRateLimiter

  @limits [per_recipient: [limit: 1, window: 60_000], per_ip: [limit: 2, window: 60_000]]

  setup do
    # The test config logs warnings and up; a denied send is an info line.
    Logger.put_module_level(EmailRateLimiter, :info)
    on_exit(fn -> Logger.delete_module_level(EmailRateLimiter) end)

    server = :"email_rate_limiter_log_#{System.unique_integer([:positive])}"
    start_supervised!({EmailRateLimiter, name: server})
    %{opts: [server: server, now: 0, limits: @limits]}
  end

  test "logs a denied send by recipient with a masked address and the IP", %{opts: opts} do
    ip = {203, 0, 113, 7}

    under =
      capture_log([level: :info], fn ->
        assert EmailRateLimiter.hit(:login_link, "user@example.com", ip, opts) == :ok
      end)

    assert under == ""

    log =
      capture_log([level: :info], fn ->
        assert EmailRateLimiter.hit(:login_link, "User@example.com", ip, opts) ==
                 {:error, :rate_limited}
      end)

    assert log =~ "Email not sent, rate limit reached"
    assert log =~ "flow=login_link"
    assert log =~ "bucket=recipient"
    assert log =~ ~s(recipient="U***@example.com")
    assert log =~ "ip=203.0.113.7"
    refute log =~ "User@example.com"
    refute log =~ "ser@"
  end

  test "logs which bucket was full for the IP bucket", %{opts: opts} do
    ip = {0x2001, 0xDB8, 0, 0, 0, 0, 0, 1}
    :ok = EmailRateLimiter.hit(:email_change_link, "a@example.com", ip, opts)
    :ok = EmailRateLimiter.hit(:email_change_link, "b@example.com", ip, opts)

    log =
      capture_log([level: :info], fn ->
        EmailRateLimiter.hit(:email_change_link, "c@example.com", ip, opts)
      end)

    assert log =~ "flow=email_change_link bucket=ip"
    assert log =~ "ip=2001:db8::1"
  end

  test "masks input without an @ and logs a missing IP as none", %{opts: opts} do
    :ok = EmailRateLimiter.hit(:login_link, "not an address", nil, opts)

    log =
      capture_log([level: :info], fn ->
        EmailRateLimiter.hit(:login_link, "not an address", nil, opts)
      end)

    assert log =~ ~s(recipient="***")
    assert log =~ "ip=none"
    refute log =~ "not an address"
  end

  test "escapes control characters and cuts long domains", %{opts: opts} do
    email = "x\n[info] forged@evil\nline" <> String.duplicate("d", 500)
    :ok = EmailRateLimiter.hit(:login_link, email, nil, opts)

    log =
      capture_log([level: :info], fn ->
        EmailRateLimiter.hit(:login_link, email, nil, opts)
      end)

    assert log =~ ~s(recipient="x***@evil\\nline)
    refute log =~ "\n[info] forged"
    assert log |> String.trim_trailing() |> String.split("\n") |> length() == 1
    refute log =~ String.duplicate("d", 100)
  end

  test "cuts the masked address by bytes, not by characters", %{opts: opts} do
    # Each "ä" is two bytes; a cut by characters would keep 200 bytes of domain.
    long_char = "e" <> String.duplicate("\u0301", 50)
    email = long_char <> "@" <> String.duplicate("ä", 150)
    :ok = EmailRateLimiter.hit(:login_link, email, nil, opts)

    log =
      capture_log([level: :info], fn ->
        EmailRateLimiter.hit(:login_link, email, nil, opts)
      end)

    assert log =~ ~s(recipient="***@#{String.duplicate("ä", 50)}")
  end

  test "logs one line per denied send", %{opts: opts} do
    :ok = EmailRateLimiter.hit(:login_link, "a@example.com", nil, opts)

    log =
      capture_log([level: :info], fn ->
        EmailRateLimiter.hit(:login_link, "a@example.com", nil, opts)
        EmailRateLimiter.hit(:login_link, "a@example.com", nil, opts)
      end)

    assert length(Regex.scan(~r/rate limit reached/, log)) == 2
  end
end
