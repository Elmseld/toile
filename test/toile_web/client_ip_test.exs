defmodule ToileWeb.ClientIPTest do
  use ExUnit.Case, async: true

  alias ToileWeb.ClientIP

  @peer %{address: {192, 0, 2, 1}, port: 4000, ssl_cert: nil}

  describe "resolve/3 with :peer" do
    test "returns the peer address and ignores X-Forwarded-For" do
      headers = [{"x-forwarded-for", "203.0.113.7"}]
      assert ClientIP.resolve(@peer, headers, :peer) == {192, 0, 2, 1}
    end

    test "returns nil without peer data" do
      assert ClientIP.resolve(nil, [], :peer) == nil
      assert ClientIP.resolve(nil, nil, :peer) == nil
    end
  end

  describe "resolve/3 with :x_forwarded_for" do
    test "returns the rightmost entry of the last header" do
      headers = [
        {"x-forwarded-for", "198.51.100.1"},
        {"x-real-ip", "198.51.100.2"},
        {"x-forwarded-for", "10.9.9.9, 203.0.113.7 , 203.0.113.8"}
      ]

      assert ClientIP.resolve(@peer, headers, :x_forwarded_for) == {203, 0, 113, 8}
    end

    test "parses IPv6 entries" do
      headers = [{"x-forwarded-for", "203.0.113.7, 2001:db8::1"}]

      assert ClientIP.resolve(@peer, headers, :x_forwarded_for) ==
               {0x2001, 0xDB8, 0, 0, 0, 0, 0, 1}
    end

    test "falls back to the peer address for an unparsable entry" do
      for value <- ["203.0.113.7, unknown", "203.0.113.7,", "", "127.1", <<0xFF, 0xFE>>] do
        assert ClientIP.resolve(@peer, [{"x-forwarded-for", value}], :x_forwarded_for) ==
                 {192, 0, 2, 1}
      end
    end

    test "falls back to the peer address without the header" do
      assert ClientIP.resolve(@peer, [{"x-real-ip", "203.0.113.7"}], :x_forwarded_for) ==
               {192, 0, 2, 1}

      assert ClientIP.resolve(@peer, [], :x_forwarded_for) == {192, 0, 2, 1}
      assert ClientIP.resolve(@peer, nil, :x_forwarded_for) == {192, 0, 2, 1}
      assert ClientIP.resolve(nil, nil, :x_forwarded_for) == nil
    end
  end
end
