#!/bin/sh
# Regression harness for scripts/install.sh.
#
# Pipes the installer into each shell with the script split into two chunks
# delivered 0.3s apart (the `curl | sh` delivery that hung in #294), with and
# without a terminal. docker and curl are stubbed through PATH, so nothing is
# downloaded or started.
#
# Usage: scripts/install-test/run.sh
#   SHELLS="dash bash sh"  shells to pipe the installer into
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
    */docker-compose.yml) cp "$STUB_REPO_ROOT/docker-compose.yml" "$out" ;;
    */env.example) cp "$STUB_REPO_ROOT/.env.example" "$out" ;;
    */api/health) exit 0 ;;
    *) echo "curl stub: unexpected URL $url" >&2; exit 22 ;;
esac
EOF
chmod +x "$WORK/bin/docker" "$WORK/bin/curl"

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
    if ! grep -q "$1" "$CASE_DIR/output"; then
        fail "output lacks '$1'"
        return 1
    fi
}

expect_env() {
    # expect_env <install-dir> <KEY=value>
    if ! grep -qx "$2" "$1/.env" 2>/dev/null; then
        fail "$1/.env lacks '$2'"
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
            && pass

        run_case "$sh_name split@$offset no terminal, defaults" "$sh_name" "$offset" no-tty
        expect_status 0 \
            && expect_output "non-interactive: using default" \
            && expect_output "Riffado is up." \
            && expect_env "$CASE_DIR/home/riffado" "APP_URL=http://localhost:3000" \
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
    CASE_ENV=""
done

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
