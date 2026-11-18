#!/bin/sh
# Regression harness for scripts/install.sh.
#
# Pipes the installer into each shell with the script split into two chunks
# delivered 0.3s apart (the `curl | sh` delivery that hung in #294), with and
# without a terminal, then checks the host port derived from APP_URL and the
# local health check (#295). docker and curl are stubbed through PATH, so
# nothing is downloaded or started, and `sleep 1` returns at once so the
# failed health check does not wait 60s.
#
# Usage: scripts/install-test/run.sh
#   SHELLS="dash bash sh"  shells to pipe the installer into; the APP_URL
#                          cases use the first one
#   INSTALL_SH=path        installer to test (default: scripts/install.sh)
#   CASE_TIMEOUT=20        seconds before a run counts as hung

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
INSTALL_SH="${INSTALL_SH:-$REPO_ROOT/scripts/install.sh}"
SHELLS="${SHELLS:-dash bash sh}"
CASE_TIMEOUT="${CASE_TIMEOUT:-20}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

mkdir -p "$WORK/bin"
cat >"$WORK/bin/docker" <<'EOF'
#!/bin/sh
printf 'docker %s\n' "$*" >>"$STUB_LOG"
if [ "$*" = "compose port app 3000" ]; then
    port=3000
    if grep -qF "\${APP_PORT" docker-compose.yml; then
        port="$(sed -n 's/^APP_PORT=//p' .env)"
    fi
    printf '0.0.0.0:%s\n' "${port:-3000}"
fi
exit 0
EOF
cat >"$WORK/bin/curl" <<'EOF'
#!/bin/sh
printf 'curl %s\n' "$*" >>"$STUB_LOG"
out=""
url=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o) out="$2"; shift 2 ;;
        -*) shift ;;
        *) url="$1"; shift ;;
    esac
done
case "$url" in
    */docker-compose.yml) cp "${STUB_COMPOSE:-$STUB_REPO_ROOT/docker-compose.yml}" "$out" ;;
    */env.example) cp "$STUB_REPO_ROOT/.env.example" "$out" ;;
    */api/health) [ "${STUB_HEALTH:-up}" = up ] ;;
    *) echo "curl stub: unexpected URL $url" >&2; exit 22 ;;
esac
EOF
cat >"$WORK/bin/sleep" <<EOF
#!/bin/sh
[ "\$*" = 1 ] && exit 0
exec $(command -v sleep) "\$@"
EOF
chmod +x "$WORK/bin/docker" "$WORK/bin/curl" "$WORK/bin/sleep"

# A docker-compose.yml from a release before APP_PORT existed.
# shellcheck disable=SC2016
sed 's/\${APP_PORT:-3000}:3000/3000:3000/' "$REPO_ROOT/docker-compose.yml" >"$WORK/compose-without-app-port.yml"

PASS=0
FAIL=0
N=0

fail() {
    FAIL=$((FAIL + 1))
    printf 'FAIL %s: %s\n' "$CASE" "$1"
    sed 's/^/    | /' "$CASE_DIR/output"
}

# run_case <name> <shell> <offset> <tty|no-tty> [pty_run.py args...]
# Pipes the installer into <shell>, split at byte <offset>. CASE_ENV holds
# extra VAR=value words for the installer's environment.
CASE_ENV=""
run_case() {
    CASE="$1"; _shell="$2"; _offset="$3"; _mode="$4"
    shift 4
    N=$((N + 1))
    CASE_DIR="$WORK/case-$N"
    mkdir -p "$CASE_DIR/home"
    _tty_flag=""
    [ "$_mode" = "no-tty" ] && _tty_flag="--no-tty"
    set +e
    # shellcheck disable=SC2016,SC2086
    env PATH="$WORK/bin:$PATH" HOME="$CASE_DIR/home" $CASE_ENV \
        STUB_LOG="$CASE_DIR/stub.log" STUB_REPO_ROOT="$REPO_ROOT" \
        python3 "$HERE/pty_run.py" $_tty_flag --timeout "$CASE_TIMEOUT" "$@" -- \
        sh -c '{ head -c "$1" "$2"; sleep 0.3; tail -c +"$(($1 + 1))" "$2"; } | "$3"' \
        _ "$_offset" "$INSTALL_SH" "$_shell" >"$CASE_DIR/output" 2>&1
    CASE_STATUS=$?
    set -e
}

expect_status() {
    if [ "$CASE_STATUS" -eq 124 ]; then
        fail "hung (killed after ${CASE_TIMEOUT}s)"
        return 1
    fi
    if [ "$CASE_STATUS" -ne "$1" ]; then
        fail "exit status $CASE_STATUS, expected $1"
        return 1
    fi
}

expect_output() {
    if ! grep -qF "$1" "$CASE_DIR/output"; then
        fail "output lacks '$1'"
        return 1
    fi
}

expect_env() {
    # expect_env <install-dir> <KEY=value>
    if ! grep -qxF "$2" "$1/.env" 2>/dev/null; then
        fail "$1/.env lacks '$2'"
        return 1
    fi
}

expect_health_url() {
    if ! grep -qxF "curl -fsS -o /dev/null $1" "$CASE_DIR/stub.log"; then
        fail "health check did not poll $1"
        return 1
    fi
}

pass() {
    PASS=$((PASS + 1))
    printf 'ok   %s\n' "$CASE"
}

SIZE="$(wc -c <"$INSTALL_SH" | tr -d ' ')"
OFFSETS="512 4096 $((SIZE / 2)) $((SIZE - 64))"

for sh_name in $SHELLS; do
    command -v "$sh_name" >/dev/null 2>&1 || { echo "missing shell: $sh_name" >&2; exit 2; }
    for offset in $OFFSETS; do
        run_case "$sh_name split@$offset terminal prompts" "$sh_name" "$offset" tty \
            --expect "Install directory" "$WORK/case-$((N + 1))/home/custom" \
            --expect "Public URL" "http://localhost:3000"
        expect_status 0 \
            && expect_output "Riffado is up." \
            && expect_env "$CASE_DIR/home/custom" "APP_URL=http://localhost:3000" \
            && expect_env "$CASE_DIR/home/custom" "APP_PORT=3000" \
            && expect_health_url "http://127.0.0.1:3000/api/health" \
            && pass

        run_case "$sh_name split@$offset no terminal, defaults" "$sh_name" "$offset" no-tty
        expect_status 0 \
            && expect_output "non-interactive: using default" \
            && expect_output "Riffado is up." \
            && expect_env "$CASE_DIR/home/riffado" "APP_URL=http://localhost:3000" \
            && expect_env "$CASE_DIR/home/riffado" "APP_PORT=3000" \
            && pass
    done

    CASE_ENV="NON_INTERACTIVE=1"
    run_case "$sh_name NON_INTERACTIVE=1 with a terminal" "$sh_name" 4096 tty
    expect_status 0 \
        && expect_output "non-interactive: using default" \
        && expect_env "$CASE_DIR/home/riffado" "APP_URL=http://localhost:3000" \
        && pass

    CASE_ENV="NON_INTERACTIVE=0"
    run_case "$sh_name NON_INTERACTIVE=0 without a terminal" "$sh_name" 4096 no-tty
    expect_status 1 \
        && expect_output "no terminal is available" \
        && pass

    CASE_ENV="NON_INTERACTIVE=true"
    run_case "$sh_name NON_INTERACTIVE=true with a terminal" "$sh_name" 4096 tty
    expect_status 0 \
        && expect_output "non-interactive: using default" \
        && pass

    CASE_ENV="NON_INTERACTIVE=maybe"
    run_case "$sh_name NON_INTERACTIVE=maybe without a terminal" "$sh_name" 4096 no-tty
    expect_status 0 \
        && expect_output "Ignoring NON_INTERACTIVE='maybe'" \
        && expect_output "non-interactive: using default" \
        && pass
    CASE_ENV=""
done

PORT_SHELL="${SHELLS%% *}"

# port_case <APP_URL answer> <expected APP_PORT> [extra expected output]
port_case() {
    run_case "APP_URL=$1 ${CASE_ENV:+($CASE_ENV) }-> APP_PORT=$2" "$PORT_SHELL" 4096 tty \
        --expect "Install directory" "" --expect "Public URL" "$1"
    expect_status 0 \
        && expect_env "$CASE_DIR/home/riffado" "APP_URL=$1" \
        && expect_env "$CASE_DIR/home/riffado" "APP_PORT=$2" \
        && expect_health_url "http://127.0.0.1:$2/api/health" \
        && { [ -z "${3:-}" ] || expect_output "$3"; } \
        && pass \
        || return 0
}

NO_PORT_NOTE="names no plain-http port on this machine"
port_case "http://localhost:3555" 3555 "host port 3555 (from http://localhost:3555)"
port_case "http://192.168.1.10:8080" 8080 "host port 8080 (from http://192.168.1.10:8080)"
port_case "http://0.0.0.0:4000" 4000
port_case "http://[::1]:3556" 3556
port_case "https://riffado.example.com" 3000 "$NO_PORT_NOTE"
port_case "http://riffado.example.com:8080" 3000 "$NO_PORT_NOTE"
port_case "http://localhost" 3000 "$NO_PORT_NOTE"
port_case "http://127.0.0.1" 3000 "Proxy to:    http://127.0.0.1:3000"
CASE_ENV="APP_PORT=8081"
port_case "https://riffado.example.com" 8081 "Proxy to:    http://127.0.0.1:8081"
CASE_ENV=""

run_case "APP_URL with an invalid port fails before installing" "$PORT_SHELL" 4096 tty \
    --expect "Install directory" "" --expect "Public URL" "http://localhost:99999"
expect_status 1 \
    && expect_output "is not a number between 1 and 65535" \
    && { [ ! -e "$CASE_DIR/home/riffado" ] || { fail "created the install dir"; false; }; } \
    && pass

CASE_ENV="APP_PORT=abc"
run_case "APP_PORT=abc fails before installing" "$PORT_SHELL" 4096 no-tty
expect_status 1 \
    && expect_output "APP_PORT must be a port number" \
    && pass
CASE_ENV=""

CASE_ENV="STUB_COMPOSE=$WORK/compose-without-app-port.yml"
run_case "compose without APP_PORT warns and health-checks the port it published" "$PORT_SHELL" 4096 tty \
    --expect "Install directory" "" --expect "Public URL" "http://localhost:3555"
expect_status 0 \
    && expect_output "does not read APP_PORT" \
    && expect_env "$CASE_DIR/home/riffado" "APP_PORT=3555" \
    && expect_health_url "http://127.0.0.1:3000/api/health" \
    && pass
CASE_ENV=""

CASE_ENV="STUB_HEALTH=down"
run_case "failed health check names the published port" "$PORT_SHELL" 4096 tty \
    --expect "Install directory" "" --expect "Public URL" "http://localhost:3555"
expect_status 1 \
    && expect_output "http://127.0.0.1:3555/api/health did not return 200" \
    && expect_output "publishes Riffado on host port 3555" \
    && pass
CASE_ENV=""

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
