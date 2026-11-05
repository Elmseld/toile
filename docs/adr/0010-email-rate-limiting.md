# 0010: Email rate limiting

Status: accepted (ticket 0011)

## Context
Nothing limited how often the app sends email (finding S3 of ADR 0002). Anyone could flood another
person's inbox through the login, registration and settings forms, and damage the sender domain's
reputation. The limit must not reveal whether an address has an account (ADR 0002 §1).

## Decision
- **Limits.** Five flows are limited: `:login_link`, `:registration_confirmation`,
  `:registration_attempt_notice`, `:email_change_link`, `:email_change_attempt_notice`.
  - Per recipient address and flow: at most 3 emails in a sliding 15 minutes. Addresses are
    compared case-insensitively (like the `citext` column).
  - Per client IP, all flows together: at most 20 emails in a sliding hour. IPv6 is counted per /64
    prefix; IPv4-mapped IPv6 counts as the IPv4 address.
  - Both are read at call time from `config :toile, Toile.Accounts.EmailRateLimiter`
    (`per_recipient:` and `per_ip:`, each `[limit: n, window: ms]`).
- **Technology: a custom in-memory GenServer** (`Toile.Accounts.EmailRateLimiter`), no new
  dependency. State is a map from key to a list of send timestamps. A send counts while it is
  younger than the window configured at check time, so a changed window also applies to sends
  already recorded. A periodic sweep drops entries older than the configured windows. Reasons:
  - *Exact sliding window.* Hammer's default ETS backend uses a fixed window, which allows up to
    twice the limit across a window boundary.
  - *Atomic two-bucket check.* A send is allowed only if both the recipient and the IP bucket have
    room, and only then are both recorded, in one `GenServer.call`. Two independent Hammer hits would
    let a denied send use up the other bucket and would race under concurrency.
  - *Volume is tiny*, so one process serialising sends costs nothing, and each list holds at most
    `limit` entries.
  - Rejected: **Postgres** (survives restarts and works across nodes, but needs a migration, a
    write per request and a cleanup job); **Hammer** (new dependency, and the two problems above).
- **Single node.** The app runs on one node. Counters live in that process.
- **Fail-open.** A restart or crash of the limiter loses the counters, which at worst allows one
  extra window of emails. If the limiter is not running or does not answer within the default
  5 second `GenServer.call` timeout, the send is allowed and a warning with only the class of the
  failure (`noproc`, `timeout`, `other`) is logged; the full exit reason holds the IP and the
  address hash. The limiter never blocks the app from starting or sending for other reasons.
- **Limit at the context entry points.** `Accounts.request_login_instructions/3` (new; replaces the
  lookup-and-send in the Login LiveView), `register_user_and_deliver_instructions/4` and
  `request_user_email_change/4` take `remote_ip:` in `opts`. The low-level `deliver_*` functions stay
  unlimited (fixtures and concurrency tests call them) and are documented as such.
- **Same response over the limit.** Nothing is sent and no token is created, but the return value,
  flash and navigation are identical. A registration over the limit still creates the user (the
  taken/new decision needs the insert); the user can request a login link later.
- **Unknown addresses count.** `request_login_instructions/3` records exactly one hit whether or not
  the address has an account, so a request for an unknown address uses the same recipient and IP
  budget as a known one. The IP budget is therefore no oracle for account existence. For a known
  address the recipient key is the stored address, not the input: the `citext` lookup matches
  case variants that `String.downcase/1` does not (`İ` for `i`), and each would otherwise get its
  own bucket.
- **Hashed keys.** The recipient key is a SHA-256 of the lowercased address. Addresses are not kept
  in memory, and attacker-chosen input (up to the socket frame limit) becomes a fixed-size key.
  Only allowed sends are recorded, so the entries one client IP can create are bounded by the IP
  limit. Total memory is not bounded: it grows with the number of distinct client IPs (IPv6 /64
  prefixes) within an hour. A call without an IP (no peer data, which does not happen for a real
  socket connection) skips the IP bucket and is bounded only per recipient.
- **Client IP.** `ToileWeb.ClientIP` resolves the IP in LiveView `mount/3` from the `/live` socket's
  `connect_info` (`:peer_data`, `:x_headers`). The default is the socket peer address. With
  `TRUST_X_FORWARDED_FOR=true` (or `1`, read in `config/runtime.exs`, prod only) it uses the
  rightmost entry of the last `X-Forwarded-For` header, which is the one a single trusted proxy
  appended; entries to its left are client-controlled. A port (`203.0.113.7:5678`,
  `[2001:db8::1]:443`) and brackets are stripped. An unparsable or missing header falls back to the
  peer address. Set this only behind exactly one proxy that appends the header; otherwise clients
  can forge their IP.
  **Deployment risk:** behind a proxy without this setting, or with a proxy whose entries still do
  not parse, every client resolves to the proxy address and all of them share one budget of 20
  emails per hour. A single abuser then blocks login links and registration emails for everyone
  until the window passes. Check this setting whenever a reverse proxy is added or changed.
- **Logging.** Each denied send is logged once at `info`: flow, which bucket was full (`recipient` or
  `ip`), the IP and a masked address (`j***@example.com`, the domain cut to 100 bytes). The full
  address is never logged, and the masked value goes through `inspect/1` so control characters are
  escaped. The IP is logged for abuse analysis. A flood of denied requests produces one line each;
  that log volume is accepted.

## Consequences
- New email flows must go through a rate-limited entry point and name a flow in `EmailRateLimiter`.
- LiveViews that send email must assign `remote_ip` from `ClientIP.get/1` in `mount/3`. No controller
  sends email.
- Tests share one global limiter; they isolate with unique recipient addresses and a unique peer IP
  per conn (`ConnCase`, `AccountsFixtures.unique_remote_ip/0`).

## Deferred
- **More than one node:** counters are per node. Move behind the same `hit/4` function with a Postgres
  table or Hammer with a Redis backend.
- **Response timing** differs between known and unknown login addresses (ticket 0016).
- **IPv6 allocations.** Counting per /64 still gives an attacker with a normal allocation (a /56 or
  /48) 256 to 65,536 IP buckets. An extra per-/48 bucket would close this; it is not needed at the
  current scale.
- **Targeted exhaustion.** The recipient limit is shared by all IPs, so a third party can use up a
  victim's login budget for 15 minutes. The victim still holds a valid link from the attacker's own
  requests, so they can log in, but cannot request a fresh one. Because the buckets are per flow,
  one address can also receive up to 3 emails per flow: for an existing account about 9 in
  15 minutes (login link, registration attempt notice, email change attempt notice). Both are
  accepted: the alternative (an IP-scoped recipient limit) gives no protection against a
  distributed flood.
- **Sweep cost.** The sweep rebuilds the whole map inside the limiter process. With a very large
  number of distinct IPs in an hour (a flood from many /64s), a sweep could take long enough that
  concurrent `hit/4` calls time out after 5 seconds and fail open. Move the state to ETS or sweep in
  chunks if that ever shows up.
