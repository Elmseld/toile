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
  - Per client IP, all flows together: at most 20 requests in a sliding hour. IPv6 is counted per
    /64 prefix; IPv4-mapped IPv6 counts as the IPv4 address. This bucket counts requests, not
    sends: a request that the recipient limit denies still takes a slot (see *IP budget is no
    oracle* below).
  - Both are read at call time from `config :toile, Toile.Accounts.EmailRateLimiter`
    (`per_recipient:` and `per_ip:`, each `[limit: n, window: ms]`).
  - In dev, `config/dev.exs` raises the per-IP limit to 1000 an hour: under Docker every request
    has the gateway as peer IP, so the whole dev environment would share one bucket of 20. The
    per-recipient limit keeps its default there so it stays observable. Tests use the defaults.
- **Technology: a custom in-memory GenServer** (`Toile.Accounts.EmailRateLimiter`), no new
  dependency. State is a map from key to a list of send timestamps. A send counts while it is
  younger than the window configured at check time, so a changed window also applies to sends
  already recorded. A periodic sweep drops entries older than the configured windows. Reasons:
  - *Exact sliding window.* Hammer's default ETS backend uses a fixed window, which allows up to
    twice the limit across a window boundary.
  - *Atomic two-bucket check.* In one `GenServer.call` the IP bucket is checked first: if it is
    full the request is denied and nothing is recorded. Otherwise the request is recorded in the
    IP bucket, and the send is allowed (and recorded in the recipient bucket) only if the recipient
    bucket has room. Two independent Hammer hits would race under concurrency.
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
  budget as a known one. For a known address the recipient key is the stored address, not the
  input: the `citext` lookup matches case variants that `String.downcase/1` does not (`İ` for
  `i`), and each would otherwise get its own bucket.
- **IP budget is no oracle.** Every entry point makes exactly one hit per request, known address or
  not, but which recipient bucket it hits does depend on account state: registration of a taken
  address hits `:registration_attempt_notice` and of a free one `:registration_confirmation`, and
  login case variants of a known address share one recipient bucket while unknown ones each get
  their own. If only allowed sends were charged to the IP bucket, a client could fill its IP budget
  to an exact count, make requests for a target, and learn from whether a login link to its own
  address still arrives whether the target has an account. So the IP bucket is charged for every
  request that passes the IP check, regardless of the recipient outcome; its consumption then
  depends only on the number of requests. The recipient bucket is still only charged for sends.
- **Hashed keys.** The recipient key is a SHA-256 of the lowercased address. Addresses are not kept
  in memory, and attacker-chosen input (up to the socket frame limit) becomes a fixed-size key.
  A request denied by the IP bucket records nothing and recipient entries are only recorded for
  allowed sends, so the entries one client IP can create are bounded by the IP limit. Total memory is not bounded: it grows with the number of distinct client IPs (IPv6 /64
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
  email requests per hour. A single abuser then blocks login links and registration emails for everyone
  until the window passes. Check this setting whenever a reverse proxy is added or changed.
- **Background delivery of login links (ticket 0016).** `request_login_instructions/3` does the
  user lookup and the one `hit/4` in the request. After an allowed hit it starts a task under
  `Toile.Accounts.EmailDeliverySupervisor` (a `Task.Supervisor` in the application tree), for
  unknown addresses too; that task does nothing. The token insert (under the user lock, ADR 0002
  §3) and the send run in the task, so the reply does not depend on account state. Spawning is
  bounded by the limiter, since a task starts only after an allowed hit. A raise or exit in the
  task is logged like a failed delivery (masked address, class only), never as a crash report.
  Deliveries in flight when the app stops may be lost (5 s shutdown grace); the user can request
  another link. Accepted residual difference: one indexed lookup that hits versus one that
  misses, microseconds and far below network jitter. Rejected: sleeping or padding to constant
  time (fragile, makes every request slow); a persistent job queue such as Oban (new dependency and
  migration for a few emails, and a lost email is recoverable); moving the lookup and hit into the
  task too (no back-pressure: every request, even an IP-denied one, would spawn work).
- **Delivery errors.** A failed send (mailer returns `{:error, reason}`) does not raise: raising only
  for addresses with an account would reveal that the account exists. It is logged at `warning` with
  the flow, the masked address and only the class of the reason (a provider response can echo the
  address), and the caller answers as for a successful send.
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
- Tests that read login-link emails, tokens or logs call `AccountsFixtures.await_email_deliveries/0`;
  `DataCase` waits for deliveries before the sandbox owner stops.

## Deferred
- **More than one node:** counters are per node. Move behind the same `hit/4` function with a Postgres
  table or Hammer with a Redis backend.
- **Response timing** of registration and email change: they still send synchronously, and
  registration has a 4th-request oracle (a free address sends 4 times before the limit, a taken one
  3, so the 4th reply is slow for a free address and fast for a taken one). Login is fixed (ticket
  0016). See ticket 0025.
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
