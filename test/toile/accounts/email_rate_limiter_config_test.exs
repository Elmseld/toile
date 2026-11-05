defmodule Toile.Accounts.EmailRateLimiterConfigTest do
  # Not async: changes the application env that every limiter call reads.
  use ExUnit.Case, async: false

  alias Toile.Accounts.EmailRateLimiter

  setup do
    original = Application.fetch_env!(:toile, EmailRateLimiter)
    on_exit(fn -> Application.put_env(:toile, EmailRateLimiter, original) end)

    server = :"email_rate_limiter_config_#{System.unique_integer([:positive])}"
    start_supervised!({EmailRateLimiter, name: server})
    %{server: server}
  end

  test "the default config is 3 per recipient in 15 minutes and 20 per IP in an hour" do
    assert Application.fetch_env!(:toile, EmailRateLimiter) == [
             per_recipient: [limit: 3, window: :timer.minutes(15)],
             per_ip: [limit: 20, window: :timer.hours(1)]
           ]
  end

  test "reads the limits from the config at call time", %{server: server} do
    Application.put_env(:toile, EmailRateLimiter,
      per_recipient: [limit: 1, window: 60_000],
      per_ip: [limit: 3, window: 60_000]
    )

    ip = {10, 255, 255, 1}

    assert EmailRateLimiter.hit(:login_link, "a@example.com", ip, server: server) == :ok

    # Denied by recipient, but it still takes the 2nd IP slot.
    assert EmailRateLimiter.hit(:login_link, "a@example.com", ip, server: server) ==
             {:error, :rate_limited}

    assert EmailRateLimiter.hit(:login_link, "b@example.com", ip, server: server) == :ok

    assert EmailRateLimiter.hit(:login_link, "c@example.com", ip, server: server) ==
             {:error, :rate_limited}

    Application.put_env(:toile, EmailRateLimiter,
      per_recipient: [limit: 5, window: 60_000],
      per_ip: [limit: 5, window: 60_000]
    )

    assert EmailRateLimiter.hit(:login_link, "a@example.com", ip, server: server) == :ok
  end

  test "reads the windows from the config at call time", %{server: server} do
    Application.put_env(:toile, EmailRateLimiter,
      per_recipient: [limit: 1, window: 1_000],
      per_ip: [limit: 1, window: 5_000]
    )

    ip = {10, 255, 255, 2}
    opts = &[server: server, now: &1]

    assert EmailRateLimiter.hit(:login_link, "w@example.com", ip, opts.(0)) == :ok

    assert EmailRateLimiter.hit(:login_link, "w@example.com", ip, opts.(999)) ==
             {:error, :rate_limited}

    # Recipient window (1s) has passed, the IP window (5s) has not.
    assert EmailRateLimiter.hit(:login_link, "w@example.com", ip, opts.(1_000)) ==
             {:error, :rate_limited}

    assert EmailRateLimiter.hit(:login_link, "w@example.com", ip, opts.(5_000)) == :ok
  end

  test "a changed window applies to sends already recorded", %{server: server} do
    Application.put_env(:toile, EmailRateLimiter,
      per_recipient: [limit: 1, window: 60_000],
      per_ip: [limit: 5, window: 60_000]
    )

    ip = {10, 255, 255, 3}
    opts = &[server: server, now: &1]

    assert EmailRateLimiter.hit(:login_link, "s@example.com", ip, opts.(0)) == :ok

    assert EmailRateLimiter.hit(:login_link, "s@example.com", ip, opts.(1_000)) ==
             {:error, :rate_limited}

    Application.put_env(:toile, EmailRateLimiter,
      per_recipient: [limit: 1, window: 1_000],
      per_ip: [limit: 5, window: 60_000]
    )

    assert EmailRateLimiter.hit(:login_link, "s@example.com", ip, opts.(1_000)) == :ok
  end
end
