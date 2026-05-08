#!/bin/sh
# OpenPlaud one-line installer.
#
# Usage:
#   curl -fsSL https://openplaud.com/install.sh | sh
#   curl -fsSL https://openplaud.com/v0.2.0/install.sh | sh   # version-pinned
#
# What this does:
#   1. Verifies Docker + docker compose v2 are installed and running.
#   2. Creates an install directory (default $HOME/openplaud).
#   3. Downloads docker-compose.yml + env.example from the GitHub release.
#   4. Generates secrets (BETTER_AUTH_SECRET, ENCRYPTION_KEY).
#   5. Pulls images and starts the stack.
#   6. Waits for /api/health to return 200.
#
# This script is part of the OpenPlaud deploy surface (see AGENTS.md).
# Source: https://github.com/openplaud/openplaud/blob/main/scripts/install.sh

set -eu

VERSION="{{VERSION}}"
REPO="openplaud/openplaud"
DEFAULT_DIR="$HOME/openplaud"
DEFAULT_APP_URL="http://localhost:3000"
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

# When piped from curl (`curl ... | sh`), stdin is the pipe, not a tty —
# so plain `read` would consume the script itself. Reopen stdin from the
# controlling tty when one exists, otherwise run non-interactively with
# defaults (CI mode).
NON_INTERACTIVE=0
if [ ! -t 0 ]; then
    # `[ -r /dev/tty ]` is not enough — GitHub Actions runners have the
    # device node with read perms but no controlling terminal, so opening
    # it errors. Probe with a no-op redirect first; only `exec` if the
    # probe succeeds.
    if (: </dev/tty) 2>/dev/null; then
        exec </dev/tty
    else
        NON_INTERACTIVE=1
    fi
fi

prompt() {
    # prompt <var> <message> <default>
    _var="$1"; _msg="$2"; _default="$3"
    if [ "$NON_INTERACTIVE" = "1" ]; then
        eval "$_var=\"\$_default\""
        printf '%s%s%s [%s] (non-interactive: using default)\n' "$DIM" "$_msg" "$RESET" "$_default"
        return
    fi
    printf '%s [%s]: ' "$_msg" "$_default"
    read -r _ans || _ans=""
    [ -z "$_ans" ] && _ans="$_default"
    eval "$_var=\"\$_ans\""
}

# ---- prerequisite checks ---------------------------------------------------

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

# ---- prompt for install dir + APP_URL --------------------------------------

prompt INSTALL_DIR "Install directory" "$DEFAULT_DIR"
prompt APP_URL "Public URL where OpenPlaud will be reachable" "$DEFAULT_APP_URL"

if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]; then
    die "$INSTALL_DIR already exists and is not empty. Pick another directory or remove it first."
fi

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
ok "Using $INSTALL_DIR"

# ---- download release artifacts --------------------------------------------

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

# ---- generate secrets ------------------------------------------------------

BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"

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

patch_env BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
patch_env ENCRYPTION_KEY "$ENCRYPTION_KEY"
patch_env APP_URL "$APP_URL"
if [ "$VERSION" != "{{VERSION}}" ] && [ -n "$VERSION" ]; then
    # VERSION starts with "v"; OPENPLAUD_VERSION expects a bare semver.
    patch_env OPENPLAUD_VERSION "${VERSION#v}"
fi
chmod 600 .env
ok "Generated secrets and wrote .env"

# ---- start the stack -------------------------------------------------------

info "Pulling images (this can take a minute on first run)..."
docker compose pull

info "Starting OpenPlaud..."
docker compose up -d

# ---- health check ----------------------------------------------------------

info "Waiting for $APP_URL/api/health (timeout ${HEALTH_TIMEOUT}s)..."
i=0
while [ "$i" -lt "$HEALTH_TIMEOUT" ]; do
    if curl -fsS -o /dev/null "$APP_URL/api/health" 2>/dev/null; then
        ok "Health check passed"
        printf '\n%s🎙  OpenPlaud is up.%s\n' "$BOLD" "$RESET"
        printf '   Open %s%s/register%s to create your account.\n\n' "$BOLD" "$APP_URL" "$RESET"
        printf '   Install dir: %s\n' "$INSTALL_DIR"
        printf '   Logs:        cd %s && docker compose logs -f\n' "$INSTALL_DIR"
        printf '   Upgrade:     cd %s && docker compose pull && docker compose up -d\n\n' "$INSTALL_DIR"
        exit 0
    fi
    i=$((i + 1))
    sleep 1
done

warn "Health check did not return 200 within ${HEALTH_TIMEOUT}s."
warn "The stack may still be starting. Check logs:"
warn "  cd $INSTALL_DIR && docker compose logs -f"
exit 1
