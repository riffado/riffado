#!/usr/bin/env bash
# Plaud egress diagnostic.
#
# Run this on the box where Plaud sync is failing. It calls Plaud's API from
# whatever IP this host egresses on, with both the minimal header set we
# currently send and the full browser-equivalent header set, against all
# three regional servers, and dumps the response status + Cloudflare
# signals + a body snippet for each.
#
# Usage:
#   PLAUD_TOKEN='eyJhbGciOi...' bash scripts/plaud-egress-probe.sh
#
# Optional:
#   PLAUD_REGIONS='eu global apse1'   # default: all three
#   HTTPS_PROXY='http://user:pass@host:port'  # to test a specific proxy URL
#   WEBSHARE_API_KEY='...'   # pick a random Webshare proxy and route through it
#                            # (equivalent to what the app does once
#                            #  WEBSHARE_API_KEY is configured on the server)
#
# The token is read from env only — never paste it on the command line, it
# would land in shell history. The token is NOT logged; only the first
# 12 chars of the JWT header segment appear in the output for sanity.
#
# Output is plain text. Paste it back in the chat for analysis.

set -o pipefail

if [[ -z "${PLAUD_TOKEN:-}" ]]; then
    echo "PLAUD_TOKEN env var is required" >&2
    echo "Usage: PLAUD_TOKEN='<jwt>' bash scripts/plaud-egress-probe.sh" >&2
    exit 2
fi

TOKEN="$PLAUD_TOKEN"
TOKEN_PREFIX="${TOKEN:0:12}..."

# If WEBSHARE_API_KEY is set, ask Webshare for a random valid proxy and
# export it as HTTPS_PROXY so the curl calls below route through it. This
# is the same flow the app uses at runtime, end-to-end.
WEBSHARE_PROXY_LABEL=""
if [[ -n "${WEBSHARE_API_KEY:-}" ]]; then
    WEBSHARE_JSON_FILE="$(mktemp)"
    WEBSHARE_HTTP_STATUS="$(curl -sS --max-time 15 \
        -H "Authorization: Token ${WEBSHARE_API_KEY}" \
        'https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=100' \
        -o "$WEBSHARE_JSON_FILE" \
        -w '%{http_code}' || true)"

    # Pick a random valid proxy. Use node (already required by the app)
    # so we don't depend on jq or python on the host. Writes two lines:
    # line 1 = full proxy URL with creds, line 2 = host:port label.
    WEBSHARE_PICK_FILE="$(mktemp)"
    node --input-type=module -e "$(cat <<'JS'
import { readFileSync } from "node:fs";
const src = process.argv[1];
const out = process.argv[2];
import { writeFileSync } from "node:fs";
let data;
try {
    data = JSON.parse(readFileSync(src, "utf8"));
} catch {
    process.exit(2);
}
const valid = (data.results || []).filter((p) => p.valid);
if (!valid.length) process.exit(3);
const p = valid[Math.floor(Math.random() * valid.length)];
const url = `http://${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@${p.proxy_address}:${p.port}`;
const label = `${p.proxy_address}:${p.port}`;
writeFileSync(out, `${url}\n${label}\n`);
JS
)" "$WEBSHARE_JSON_FILE" "$WEBSHARE_PICK_FILE" 2>/dev/null || true

    if [[ -s "$WEBSHARE_PICK_FILE" ]]; then
        HTTPS_PROXY="$(sed -n '1p' "$WEBSHARE_PICK_FILE")"
        WEBSHARE_PROXY_LABEL="$(sed -n '2p' "$WEBSHARE_PICK_FILE")"
        export HTTPS_PROXY
    else
        # Diagnose without ever printing the raw Webshare body — the
        # response payload contains proxy credentials (username +
        # password fields) that must not leak into pasted logs.
        WEBSHARE_BODY_BYTES="$(wc -c < "$WEBSHARE_JSON_FILE" 2>/dev/null | tr -d ' ' || echo 0)"
        echo "WEBSHARE_API_KEY set but proxy selection failed (continuing direct)" >&2
        echo "  Webshare HTTP status: ${WEBSHARE_HTTP_STATUS:-<unknown>}" >&2
        echo "  Webshare body bytes:  ${WEBSHARE_BODY_BYTES}" >&2
        echo "  (raw response not printed: it contains proxy credentials)" >&2
        echo "  Common causes: bad API key (expect 401), no valid proxies on the plan, or node missing on host." >&2
    fi
    rm -f "$WEBSHARE_JSON_FILE" "$WEBSHARE_PICK_FILE"
fi

# -------- regions --------
# Bash 3.2 (macOS default) has no associative arrays; use a case lookup.
REGIONS="${PLAUD_REGIONS:-eu global apse1}"

region_base() {
    case "$1" in
        global) echo "https://api.plaud.ai" ;;
        eu)     echo "https://api-euc1.plaud.ai" ;;
        apse1)  echo "https://api-apse1.plaud.ai" ;;
        *)      echo "" ;;
    esac
}

# -------- header sets --------
MIN_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
BROWSER_UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

# Returns curl -H args for the "minimal" set (what Riffado sends today).
min_headers() {
    printf -- '-H\0Authorization: Bearer %s\0' "$TOKEN"
    printf -- '-H\0Content-Type: application/json\0'
    printf -- '-H\0User-Agent: %s\0' "$MIN_UA"
}

# Returns curl -H args for the full browser-equivalent set (per the HAR).
browser_headers() {
    printf -- '-H\0Authorization: Bearer %s\0' "$TOKEN"
    printf -- '-H\0Accept: application/json, text/plain, */*\0'
    printf -- '-H\0Content-Type: application/json\0'
    printf -- '-H\0app-language: en\0'
    printf -- '-H\0app-platform: web\0'
    printf -- '-H\0edit-from: web\0'
    printf -- '-H\0timezone: UTC\0'
    printf -- '-H\0x-device-id: %s\0' "$(openssl rand -hex 8 2>/dev/null || echo 0123456789abcdef)"
    printf -- '-H\0x-request-id: probe-%s\0' "$(openssl rand -hex 4 2>/dev/null || echo deadbeef)"
    printf -- '-H\0Origin: https://web.plaud.ai\0'
    printf -- '-H\0Referer: https://web.plaud.ai/\0'
    printf -- '-H\0User-Agent: %s\0' "$BROWSER_UA"
}

probe() {
    local label="$1" url="$2" method="$3" headers_fn="$4" body="${5:-}"
    local hdr_file body_file
    hdr_file="$(mktemp)"
    body_file="$(mktemp)"

    # Build a NUL-delimited arg array so header values with spaces are safe.
    local args=()
    while IFS= read -r -d '' a; do args+=("$a"); done < <("$headers_fn")

    local curl_args=(
        --silent --show-error
        --max-time 20
        --request "$method"
        --dump-header "$hdr_file"
        --output "$body_file"
        --write-out 'HTTP %{http_code} | time=%{time_total}s | remote=%{remote_ip}\n'
        "${args[@]}"
    )
    if [[ -n "${HTTPS_PROXY:-}" ]]; then
        curl_args+=(--proxy "$HTTPS_PROXY")
    fi
    if [[ -n "$body" ]]; then
        curl_args+=(--data "$body")
    fi
    curl_args+=("$url")

    printf -- '--- %s ---\n' "$label"
    printf 'URL:    %s %s\n' "$method" "$url"
    if [[ -n "${HTTPS_PROXY:-}" ]]; then
        # Show the label (host:port) only — never the full URL, which
        # would leak the proxy credentials into logs that get pasted.
        printf 'Proxy:  %s\n' "${WEBSHARE_PROXY_LABEL:-<custom>}"
    fi
    curl "${curl_args[@]}" || printf 'curl exited %d\n' "$?"

    # Cloudflare / origin signals
    grep -iE '^(cf-ray|cf-mitigated|cf-cache-status|server|x-trace-id|content-type|retry-after):' "$hdr_file" \
        | sed 's/\r$//' | sed 's/^/  /'

    # Body snippet (first 400 chars, single line)
    if [[ -s "$body_file" ]]; then
        local snippet
        snippet="$(LC_ALL=C tr -d '\r\n' < "$body_file" | cut -c1-400)"
        printf 'Body:   %s\n' "$snippet"
    else
        printf 'Body:   (empty)\n'
    fi
    printf '\n'

    rm -f "$hdr_file" "$body_file"
}

DIRECT_EGRESS_IP="$(curl -sS --max-time 8 https://api.ipify.org 2>/dev/null || echo unknown)"
PROXY_EGRESS_IP=""
PROXY_LINE="<unset>"
if [[ -n "${HTTPS_PROXY:-}" ]]; then
    PROXY_EGRESS_IP="$(curl -sS --max-time 12 --proxy "$HTTPS_PROXY" https://api.ipify.org 2>/dev/null || echo unknown)"
    PROXY_LINE="set (label=${WEBSHARE_PROXY_LABEL:-custom})"
fi

cat <<EOF
Plaud egress probe
==================
Host:           $(hostname)
Direct IP:      ${DIRECT_EGRESS_IP}
Proxy:          ${PROXY_LINE}
Proxy egress:   ${PROXY_EGRESS_IP:-<n/a>}
Token:          ${TOKEN_PREFIX} (len=${#TOKEN})
Regions:        ${REGIONS}
Time:           $(date -u +%FT%TZ)

EOF

for region in $REGIONS; do
    base="$(region_base "$region")"
    if [[ -z "$base" ]]; then
        echo "Unknown region '$region', skipping" >&2
        continue
    fi

    echo "================================================================"
    echo "Region: $region ($base)"
    echo "================================================================"

    probe "[$region] workspaces/list  | minimal headers" \
        "$base/team-app/workspaces/list?need_personal_workspace=true" \
        GET min_headers

    probe "[$region] workspaces/list  | browser headers" \
        "$base/team-app/workspaces/list?need_personal_workspace=true" \
        GET browser_headers

    probe "[$region] device/list (UT) | minimal headers" \
        "$base/device/list" \
        GET min_headers

    probe "[$region] device/list (UT) | browser headers" \
        "$base/device/list" \
        GET browser_headers

    probe "[$region] user/me           | minimal headers" \
        "$base/user/me" \
        GET min_headers
done

echo "Done. Paste the full output above back to the chat."
