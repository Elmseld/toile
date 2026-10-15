# Development image. The code is bind-mounted at /app by compose.yaml, so it is not copied here.
#
# Versions must match .tool-versions, the single source of truth that CI also uses.
# bin/check-tool-versions enforces it in CI.
ARG ELIXIR_VERSION=1.20.4
ARG OTP_VERSION=29.1.2
ARG DEBIAN_VERSION=trixie-20261005-slim
ARG BUN_VERSION=1.4.3

FROM oven/bun:${BUN_VERSION}-slim AS bun

FROM hexpm/elixir:${ELIXIR_VERSION}-erlang-${OTP_VERSION}-debian-${DEBIAN_VERSION} AS dev
ARG UID=1000
ARG GID=1000

# build-essential: bcrypt_elixir NIF. git: GitHub deps (heroicons).
# inotify-tools: file_system, for live reload and the code reloader.
# ca-certificates: Tailwind/esbuild downloads in mix assets.setup.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential git inotify-tools ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

# The GID may already exist in the image (e.g. 20, macOS "staff", is "dialout" here), so reuse it.
RUN (getent group "$GID" || groupadd -g "$GID" app) \
  && useradd -m -u "$UID" -g "$GID" app

ENV LANG=C.UTF-8 \
  MIX_HOME=/home/app/.mix \
  HEX_HOME=/home/app/.hex

# New named volumes copy the ownership of the directory they are mounted on,
# so these must exist and belong to app, or mix deps.get fails as root-owned.
RUN mkdir -p /app/deps /app/_build /app/engine/node_modules /home/app/.hex \
  && chown -R "$UID:$GID" /app /home/app

USER app
WORKDIR /app

# Hex and rebar live in MIX_HOME inside the image (not a volume), so every
# image rebuild installs them for the current OTP.
RUN mix local.hex --force && mix local.rebar --force

EXPOSE 4000
CMD ["bin/docker-dev-server"]
