#!/bin/sh
# Mesynx AI one-line installer.
#
# Usage:
#   curl -fsSL https://mesynx.r0073dl053r.com/install.sh | sh
#   curl -fsSL https://mesynx.r0073dl053r.com/v0.2.0/install.sh | sh   # version-pinned
#
# What this does:
#   1. Verifies Docker + docker compose v2 are installed and running.
#   2. Creates an install directory (default $HOME/mesynx).
#   3. Downloads docker-compose.yml + env.example from the GitHub release.
#   4. Generates secrets (BETTER_AUTH_SECRET, ENCRYPTION_KEY).
#   5. Pulls the CPU core images and starts the stack. GPU (diarization +
#      CUDA transcription) is opt-in via docker-compose.gpu.yml — see the
#      hint printed on success.
#   6. Waits for /api/health to return 200.
#
# This script is part of the Mesynx AI deploy surface (see AGENTS.md).
# Source: https://github.com/r0073d-l053r/mesynx/blob/main/scripts/install.sh

set -eu

VERSION="{{VERSION}}"
REPO="r0073d-l053r/mesynx"
DEFAULT_DIR="$HOME/mesynx"
DEFAULT_APP_URL="http://localhost:8790"
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
prompt APP_URL "Public URL where Mesynx AI will be reachable" "$DEFAULT_APP_URL"

if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]; then
    die "$INSTALL_DIR already exists and is not empty. Pick another directory or remove it first."
fi

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
ok "Using $INSTALL_DIR"

# ---- download release artifacts --------------------------------------------

# VERSION is the literal placeholder when run directly from raw main (not a
# published release). Use the release download URL only when VERSION looks
# like a real semver tag (vX.Y.Z); fall back to raw main otherwise.
if ! printf '%s' "$VERSION" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+'; then
    BASE_URL="https://raw.githubusercontent.com/$REPO/main"
    info "Downloading configuration files from $BASE_URL..."
    CACHE_BUSTER="?v=$(date +%s)"
    # The root docker-compose.yml is the DEV compose (build: context: .) and
    # would try to build from source that isn't present in the install dir.
    # Self-host installs need the PRODUCTION compose under deploy/, which pulls
    # the pre-built GHCR image instead.
    curl -fsSL -o docker-compose.yml "$BASE_URL/deploy/docker-compose.yml$CACHE_BUSTER" \
        || die "Failed to download docker-compose.yml from $BASE_URL/deploy"
    curl -fsSL -o .env "$BASE_URL/env.example$CACHE_BUSTER" \
        || curl -fsSL -o .env "$BASE_URL/.env.example$CACHE_BUSTER" \
        || die "Failed to download env.example from $BASE_URL"
    # Optional GPU override (for later opt-in). Best-effort: a missing file
    # must not fail a CPU-only install.
    curl -fsSL -o docker-compose.gpu.yml "$BASE_URL/deploy/docker-compose.gpu.yml$CACHE_BUSTER" \
        || warn "Could not fetch docker-compose.gpu.yml; GPU opt-in unavailable in this install."
else
    BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
    info "Downloading release $VERSION artifacts..."
    curl -fsSL -o docker-compose.yml "$BASE_URL/docker-compose.yml" \
        || die "Failed to download docker-compose.yml from $BASE_URL"
    curl -fsSL -o .env "$BASE_URL/env.example" \
        || die "Failed to download env.example from $BASE_URL"
    # Optional GPU override (for later opt-in). Best-effort: older releases
    # may not ship it.
    curl -fsSL -o docker-compose.gpu.yml "$BASE_URL/docker-compose.gpu.yml" \
        || warn "Could not fetch docker-compose.gpu.yml; GPU opt-in unavailable in this install."
fi
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
    # VERSION starts with "v"; MESYNX_AI_VERSION expects a bare semver.
    patch_env MESYNX_AI_VERSION "${VERSION#v}"
fi
chmod 600 .env
ok "Generated secrets and wrote .env"

# ---- start the stack -------------------------------------------------------

# The core stack is CPU-only. The GPU diarization service (whisperx) and the
# CUDA whisper image are opt-in via docker-compose.gpu.yml (see the success
# hint below), so a flaky/large GPU image pull can't break the install.
# whisperx sits behind the `gpu` compose profile, so a plain pull/up skips it.
info "Pulling images (this may take a few minutes on first run)..."
docker compose pull \
    || die "Failed to pull images. Check your network and try again."

info "Starting Mesynx AI..."
docker compose up -d

# ---- health check ----------------------------------------------------------

info "Waiting for $APP_URL/api/health (timeout ${HEALTH_TIMEOUT}s)..."
i=0
while [ "$i" -lt "$HEALTH_TIMEOUT" ]; do
    if curl -fsS -o /dev/null "$APP_URL/api/health" 2>/dev/null; then
        ok "Health check passed"
        printf '\n%s🎙  Mesynx AI is up.%s\n' "$BOLD" "$RESET"
        printf '   Open %s%s/register%s to create your account.\n\n' "$BOLD" "$APP_URL" "$RESET"
        printf '   Install dir: %s\n' "$INSTALL_DIR"
        printf '   Logs:        cd %s && docker compose logs -f\n' "$INSTALL_DIR"
        printf '   Upgrade:     cd %s && docker compose pull && docker compose up -d\n' "$INSTALL_DIR"
        if [ -f docker-compose.gpu.yml ]; then
            printf '   Enable GPU:  cd %s && docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile gpu up -d\n' "$INSTALL_DIR"
            printf '                (needs the NVIDIA Container Toolkit; adds diarization + CUDA transcription)\n'
        fi
        printf '\n'
        exit 0
    fi
    i=$((i + 1))
    sleep 1
done

warn "Health check did not return 200 within ${HEALTH_TIMEOUT}s."
warn "The stack may still be starting. Check logs:"
warn "  cd $INSTALL_DIR && docker compose logs -f"
exit 1
