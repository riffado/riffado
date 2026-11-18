#!/bin/sh
# Riffado one-line installer.
#
# Usage:
#   curl -fsSL https://riffado.com/install.sh | sh
#   curl -fsSL https://riffado.com/v0.2.0/install.sh | sh   # version-pinned
#   curl -fsSL https://riffado.com/install.sh | NON_INTERACTIVE=1 sh   # defaults
#   curl -fsSL https://riffado.com/install.sh | APP_PORT=8080 sh   # host port
#
# What this does:
#   1. Verifies Docker + docker compose v2 are installed and running.
#   2. Creates an install directory (default $HOME/riffado).
#   3. Downloads docker-compose.yml + env.example from the GitHub release.
#   4. Generates secrets (BETTER_AUTH_SECRET, ENCRYPTION_KEY, POSTGRES_PASSWORD)
#      and writes APP_URL and APP_PORT.
#   5. Pulls images and starts the stack.
#   6. Waits for http://127.0.0.1:<published port>/api/health to return 200.
#
# This script is part of the Riffado deploy surface (see AGENTS.md).
# Source: https://github.com/riffado/riffado/blob/main/scripts/install.sh

set -eu

VERSION="{{VERSION}}"
REPO="riffado/riffado"
DEFAULT_DIR="$HOME/riffado"
DEFAULT_APP_URL="http://localhost:3000"
DEFAULT_APP_PORT=3000
HEALTH_TIMEOUT=60

# ---- output helpers --------------------------------------------------------

if [ -t 1 ]; then
    BOLD="$(printf '\033[1m')"
    DIM="$(printf '\033[2m')"
    RED="$(printf '\033[31m')"
    GREEN="$(printf '\033[32m')"
    YELLOW="$(printf '\033[33m')"
    RESET="$(printf '\033[0m')"
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

info()  { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$1"; }
ok()    { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn()  { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()   { printf '%serror:%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

# ---- tty handling ----------------------------------------------------------

# When piped from curl (`curl ... | sh`), stdin is the script itself, so
# prompts read from /dev/tty one `read` at a time and stdin is never
# replaced. NON_INTERACTIVE=1 (or true/yes) takes every default;
# NON_INTERACTIVE=0 (or false/no) requires a terminal; unset uses the
# terminal when one exists and the defaults otherwise (CI mode). Any other
# value warns and is treated as unset.
detect_tty() {
    case "${NON_INTERACTIVE:-}" in
        1|true|TRUE|True|yes|YES|Yes) NON_INTERACTIVE=1; return 0 ;;
        0|false|FALSE|False|no|NO|No) NON_INTERACTIVE=0 ;;
        "") ;;
        *)
            warn "Ignoring NON_INTERACTIVE='$NON_INTERACTIVE' (use 1 or 0); detecting a terminal instead."
            NON_INTERACTIVE=""
            ;;
    esac
    # `[ -r /dev/tty ]` is not enough: GitHub Actions runners have the
    # device node with read perms but no controlling terminal, so opening
    # it errors. Probe with a no-op redirect instead.
    if (: </dev/tty) 2>/dev/null; then
        NON_INTERACTIVE=0
    elif [ "${NON_INTERACTIVE:-}" = "0" ]; then
        die "NON_INTERACTIVE=0 but no terminal is available (/dev/tty cannot be opened). Run the installer from an interactive terminal, or set NON_INTERACTIVE=1 to accept the defaults."
    else
        NON_INTERACTIVE=1
    fi
}

prompt() {
    # prompt <var> <message> <default>
    _var="$1"; _msg="$2"; _default="$3"
    if [ "$NON_INTERACTIVE" = "1" ]; then
        eval "$_var=\"\$_default\""
        printf '%s%s%s [%s] (non-interactive: using default)\n' "$DIM" "$_msg" "$RESET" "$_default"
        return
    fi
    printf '%s [%s]: ' "$_msg" "$_default"
    read -r _ans </dev/tty || _ans=""
    [ -z "$_ans" ] && _ans="$_default"
    eval "$_var=\"\$_ans\""
}

# Patch the .env in place. macOS ships BSD sed which requires a backup-suffix
# arg to -i; GNU sed does not. Use a temp file + mv to stay portable.
patch_env() {
    # patch_env <key> <value>
    _key="$1"; _value="$2"
    _tmp="$(mktemp)"
    awk -v k="$_key" -v v="$_value" '
        BEGIN { written = 0 }
        {
            # Match an existing assignment, commented or not.
            if ($0 ~ "^[[:space:]]*#?[[:space:]]*" k "=") {
                print k "=" v
                written = 1
                next
            }
            print
        }
        END {
            if (!written) print k "=" v
        }
    ' .env > "$_tmp" && mv "$_tmp" .env
}

# ---- published port -------------------------------------------------------

valid_port() {
    case "$1" in
        ""|0*|*[!0-9]*) return 1 ;;
    esac
    [ "${#1}" -le 5 ] && [ "$1" -le 65535 ]
}

is_ipv4() {
    case "$1" in
        ""|*[!0-9.]*|.*|*.|*..*) return 1 ;;
    esac
    _old_ifs="$IFS"
    IFS=.
    # shellcheck disable=SC2086
    set -- $1
    IFS="$_old_ifs"
    [ "$#" -eq 4 ] || return 1
    for _octet in "$@"; do
        [ "${#_octet}" -le 3 ] && [ "$_octet" -le 255 ] || return 1
    done
}

# url_host_port <url>: print the port of an http:// URL on localhost or an
# IP literal, where Riffado is served directly on that port. Prints nothing
# for hostnames, https:// and URLs without a port: those point at a reverse
# proxy on 80/443 that forwards to the published port.
url_host_port() {
    _url="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    case "$_url" in
        http://*) _authority="${_url#http://}" ;;
        *) return 0 ;;
    esac
    _authority="${_authority%%/*}"
    _authority="${_authority%%\?*}"
    _authority="${_authority%%#*}"
    _authority="${_authority##*@}"
    case "$_authority" in
        \[*\]:*) _host="${_authority%%]:*}]"; _port="${_authority##*]:}" ;;
        *:*) _host="${_authority%%:*}"; _port="${_authority#*:}" ;;
        *) return 0 ;;
    esac
    case "$_host" in
        localhost|*.localhost|\[*\]) ;;
        *) is_ipv4 "$_host" || return 0 ;;
    esac
    printf '%s\n' "$_port"
}

main() {
    detect_tty

    # ---- prerequisite checks -----------------------------------------------

    OS="$(uname -s)"
    case "$OS" in
        Linux|Darwin) ;;
        MINGW*|MSYS*|CYGWIN*) die "Windows is not supported directly. Use WSL2: https://learn.microsoft.com/windows/wsl/install" ;;
        *) die "Unsupported OS: $OS (Linux and macOS only)" ;;
    esac
    ok "Detected $OS"

    command -v curl  >/dev/null 2>&1 || die "curl is required but not installed"
    command -v openssl >/dev/null 2>&1 || die "openssl is required but not installed"
    command -v docker >/dev/null 2>&1 || die "Docker is required. Install: https://docs.docker.com/get-docker/"

    if ! docker info >/dev/null 2>&1; then
        die "Docker daemon is not running or your user lacks permission. Start Docker Desktop / 'sudo systemctl start docker' / add yourself to the docker group."
    fi
    ok "Docker daemon reachable"

    if ! docker compose version >/dev/null 2>&1; then
        die "Docker Compose v2 is required. 'docker compose version' failed. Install: https://docs.docker.com/compose/install/"
    fi
    ok "Docker Compose v2 available"

    # ---- prompt for install dir + APP_URL ----------------------------------

    prompt INSTALL_DIR "Install directory" "$DEFAULT_DIR"
    prompt APP_URL "Public URL where Riffado will be reachable" "$DEFAULT_APP_URL"

    if [ -n "${APP_PORT:-}" ]; then
        valid_port "$APP_PORT" \
            || die "APP_PORT must be a port number between 1 and 65535 (got '$APP_PORT')."
        ok "Publishing Riffado on host port $APP_PORT (from APP_PORT)"
    else
        APP_PORT="$(url_host_port "$APP_URL")"
        if [ -z "$APP_PORT" ]; then
            APP_PORT="$DEFAULT_APP_PORT"
            ok "Publishing Riffado on host port $APP_PORT: $APP_URL names no plain-http port on this machine."
            info "Point a reverse proxy at http://127.0.0.1:$APP_PORT, or rerun with APP_PORT=<port> to publish on another port."
        elif ! valid_port "$APP_PORT"; then
            die "The port in $APP_URL is not a number between 1 and 65535."
        else
            ok "Publishing Riffado on host port $APP_PORT (from $APP_URL)"
        fi
    fi

    if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]; then
        die "$INSTALL_DIR already exists and is not empty. Pick another directory or remove it first."
    fi

    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    ok "Using $INSTALL_DIR"

    # ---- download release artifacts ----------------------------------------

    if [ "$VERSION" = "{{VERSION}}" ] || [ -z "$VERSION" ]; then
        # Should not happen — the script is rendered server-side with a version
        # substituted in. Defend anyway.
        BASE_URL="https://github.com/$REPO/releases/latest/download"
        info "Downloading latest release artifacts..."
    else
        BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
        info "Downloading release $VERSION artifacts..."
    fi

    curl -fsSL -o docker-compose.yml "$BASE_URL/docker-compose.yml" \
        || die "Failed to download docker-compose.yml from $BASE_URL"
    curl -fsSL -o .env "$BASE_URL/env.example" \
        || die "Failed to download env.example from $BASE_URL"
    ok "Downloaded docker-compose.yml and .env"
    if [ "$APP_PORT" != "$DEFAULT_APP_PORT" ] && ! grep -qF "\${APP_PORT" docker-compose.yml; then
        warn "This release's docker-compose.yml does not read APP_PORT, so Riffado will be published on port $DEFAULT_APP_PORT, not $APP_PORT."
    fi

    # ---- generate secrets --------------------------------------------------

    BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
    ENCRYPTION_KEY="$(openssl rand -hex 32)"
    POSTGRES_PASSWORD="$(openssl rand -hex 24)"

    patch_env BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
    patch_env ENCRYPTION_KEY "$ENCRYPTION_KEY"
    patch_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
    patch_env APP_URL "$APP_URL"
    patch_env APP_PORT "$APP_PORT"
    if [ "$VERSION" != "{{VERSION}}" ] && [ -n "$VERSION" ]; then
        # VERSION starts with "v"; RIFFADO_VERSION expects a bare semver.
        patch_env RIFFADO_VERSION "${VERSION#v}"
    fi
    chmod 600 .env
    ok "Generated secrets and wrote .env"

    # ---- start the stack ---------------------------------------------------

    info "Pulling images (this can take a minute on first run)..."
    docker compose pull

    info "Starting Riffado..."
    docker compose up -d

    # ---- health check ------------------------------------------------------

    # The published port is what docker actually bound, which differs from
    # APP_PORT when an older docker-compose.yml ignores it.
    PUBLISHED_PORT="$(docker compose port app 3000 2>/dev/null | head -n 1 || true)"
    PUBLISHED_PORT="${PUBLISHED_PORT##*:}"
    valid_port "$PUBLISHED_PORT" || PUBLISHED_PORT="$APP_PORT"
    HEALTH_URL="http://127.0.0.1:$PUBLISHED_PORT/api/health"

    info "Waiting for $HEALTH_URL (timeout ${HEALTH_TIMEOUT}s)..."
    i=0
    while [ "$i" -lt "$HEALTH_TIMEOUT" ]; do
        if curl -fsS -o /dev/null "$HEALTH_URL" 2>/dev/null; then
            ok "Health check passed"
            printf '\n%s🎙  Riffado is up.%s\n' "$BOLD" "$RESET"
            printf '   Open %s%s/register%s to create your account.\n\n' "$BOLD" "$APP_URL" "$RESET"
            printf '   Install dir: %s\n' "$INSTALL_DIR"
            if [ "$(url_host_port "$APP_URL")" != "$PUBLISHED_PORT" ]; then
                printf '   Proxy to:    http://127.0.0.1:%s\n' "$PUBLISHED_PORT"
            fi
            printf '   Logs:        cd %s && docker compose logs -f\n' "$INSTALL_DIR"
            printf '   Upgrade:     cd %s && docker compose pull && docker compose up -d\n\n' "$INSTALL_DIR"
            exit 0
        fi
        i=$((i + 1))
        sleep 1
    done

    warn "$HEALTH_URL did not return 200 within ${HEALTH_TIMEOUT}s."
    warn "The stack publishes Riffado on host port $PUBLISHED_PORT."
    warn "It may still be starting. Check logs:"
    warn "  cd $INSTALL_DIR && docker compose logs -f"
    exit 1
}

# Keep this the last line: the shell has to parse all of main() before it
# runs any of it, so a partially delivered `curl | sh` never executes.
main "$@"
