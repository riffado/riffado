/**
 * Minimal CIDR allowlist matcher for the admin gate.
 *
 * Supports IPv4 (a.b.c.d/n), IPv6 (::1/128), and bare-IP entries (treated as
 * /32 or /128). Anything malformed in the env var is logged and ignored --
 * the gate fails closed, so a typo in ADMIN_IP_ALLOWLIST means nobody passes,
 * not "everybody passes."
 */

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let acc = 0;
    for (const p of parts) {
        const n = Number(p);
        if (!Number.isInteger(n) || n < 0 || n > 255) return null;
        acc = (acc << 8) + n;
    }
    // Force unsigned 32-bit
    return acc >>> 0;
}

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_16 = BigInt(16);
const BIG_V4_MASK = BigInt("0xffffffff");

function ipv6ToBigInt(ip: string): bigint | null {
    // Expand `::` and validate. Accepts IPv4-mapped form (::ffff:1.2.3.4)
    // by converting the trailing IPv4 chunk to two hex groups.
    let s = ip;
    const v4Match = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (v4Match) {
        const v4 = ipv4ToInt(v4Match[2]);
        if (v4 === null) return null;
        const hi = (v4 >>> 16) & 0xffff;
        const lo = v4 & 0xffff;
        s = `${v4Match[1]}${hi.toString(16)}:${lo.toString(16)}`;
    }
    // RFC 4291: a valid IPv6 address contains AT MOST ONE `::`. Reject
    // anything with two or more (e.g. `1::2::3`) so spurious empty groups
    // can't slip through after the split/filter below.
    const doubleColon = s.indexOf("::");
    if (doubleColon !== s.lastIndexOf("::")) return null;
    let groups: string[];
    if (doubleColon !== -1) {
        const left = s.slice(0, doubleColon).split(":").filter(Boolean);
        const right = s
            .slice(doubleColon + 2)
            .split(":")
            .filter(Boolean);
        const fillCount = 8 - left.length - right.length;
        if (fillCount < 0) return null;
        groups = [...left, ...new Array(fillCount).fill("0"), ...right];
    } else {
        groups = s.split(":");
    }
    if (groups.length !== 8) return null;
    let acc = BIG_ZERO;
    for (const g of groups) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        acc = (acc << BIG_16) + BigInt(parseInt(g, 16));
    }
    return acc;
}

function isV4(ip: string): boolean {
    return /^\d+\.\d+\.\d+\.\d+$/.test(ip);
}

interface ParsedCidr {
    family: 4 | 6;
    base: bigint;
    bits: number;
}

function parseCidr(entry: string): ParsedCidr | null {
    // Reject malformed entries up front:
    //   - more than one `/`         (e.g. "10.0.0.0/24/extra")
    //   - empty bits portion        (e.g. "10.0.0.0/")
    //   - non-digit bits portion    (e.g. "10.0.0.0/abc")
    // A bare "10.0.0.0/" previously parsed as bits=0 (Number("") === 0),
    // which silently allowed all IPs in that family.
    const slashCount = (entry.match(/\//g) ?? []).length;
    if (slashCount > 1) return null;
    let ipPart: string;
    let bitsPart: string | undefined;
    if (slashCount === 1) {
        const [ip, b] = entry.split("/");
        if (b === "" || !/^\d+$/.test(b)) return null;
        ipPart = ip;
        bitsPart = b;
    } else {
        ipPart = entry;
        bitsPart = undefined;
    }
    if (isV4(ipPart)) {
        const ipInt = ipv4ToInt(ipPart);
        if (ipInt === null) return null;
        const bits = bitsPart === undefined ? 32 : Number(bitsPart);
        if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
        // Mask the base so 10.0.0.5/24 == 10.0.0.0/24
        const mask =
            bits === 0
                ? BIG_ZERO
                : (BIG_V4_MASK << BigInt(32 - bits)) & BIG_V4_MASK;
        return { family: 4, base: BigInt(ipInt) & mask, bits };
    }
    const ipBig = ipv6ToBigInt(ipPart);
    if (ipBig === null) return null;
    const bits = bitsPart === undefined ? 128 : Number(bitsPart);
    if (!Number.isInteger(bits) || bits < 0 || bits > 128) return null;
    const mask =
        bits === 0
            ? BIG_ZERO
            : ((BIG_ONE << BigInt(bits)) - BIG_ONE) << BigInt(128 - bits);
    return { family: 6, base: ipBig & mask, bits };
}

/**
 * Returns true if the given client IP matches any CIDR in the allowlist.
 * An empty allowlist returns true (= check disabled). A non-empty allowlist
 * with no parseable entries returns false (fail closed on misconfiguration).
 */
export function ipMatchesAllowlist(
    clientIp: string | null | undefined,
    allowlist: readonly string[],
): boolean {
    if (allowlist.length === 0) return true;
    if (!clientIp) return false;

    // Strip v6-bracket form and IPv4-mapped prefix variants
    let ip = clientIp.trim().replace(/^\[|\]$/g, "");
    if (ip.startsWith("::ffff:") && ip.includes(".")) {
        ip = ip.slice(7);
    }

    const parsedEntries = allowlist
        .map(parseCidr)
        .filter((p): p is ParsedCidr => p !== null);
    if (parsedEntries.length === 0) {
        // Misconfigured allowlist -- fail closed.
        return false;
    }

    if (isV4(ip)) {
        const ipInt = ipv4ToInt(ip);
        if (ipInt === null) return false;
        const ipBig = BigInt(ipInt);
        for (const e of parsedEntries) {
            if (e.family !== 4) continue;
            const mask =
                e.bits === 0
                    ? BIG_ZERO
                    : (BIG_V4_MASK << BigInt(32 - e.bits)) & BIG_V4_MASK;
            if ((ipBig & mask) === e.base) return true;
        }
        return false;
    }

    const ipBig = ipv6ToBigInt(ip);
    if (ipBig === null) return false;
    for (const e of parsedEntries) {
        if (e.family !== 6) continue;
        const mask =
            e.bits === 0
                ? BIG_ZERO
                : ((BIG_ONE << BigInt(e.bits)) - BIG_ONE) <<
                  BigInt(128 - e.bits);
        if ((ipBig & mask) === e.base) return true;
    }
    return false;
}

/**
 * Best-effort client-IP extraction. Order of preference:
 *   1. x-forwarded-for (first entry, since edge proxies append on the right)
 *   2. x-real-ip
 *
 * If neither header is set we return null and the allowlist check fails closed
 * when an allowlist is configured.
 *
 * Trust model: this function trusts the headers. If the OpenPlaud server is
 * exposed to the public internet without a proxy, an attacker can SET
 * x-forwarded-for in their request and bypass the IP gate. Mitigation lives
 * at the deploy layer:
 *   - Run behind a proxy (Caddy/nginx/Cloudflare) that REPLACES (not appends)
 *     incoming x-forwarded-for with the actual client IP, or
 *   - Don't enable ADMIN_IP_ALLOWLIST and rely on the email + reauth chain.
 *
 * `warnIfIpAllowlistTrustsXff` (called from auth-server module load) prints
 * a single startup line when ADMIN_IP_ALLOWLIST is configured, reminding the
 * operator to verify their proxy strips inbound XFF.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
    const xff = headers.get("x-forwarded-for");
    if (xff) {
        const first = xff.split(",")[0]?.trim();
        if (first) return first;
    }
    const xri = headers.get("x-real-ip");
    if (xri) return xri.trim();
    return null;
}

let warned = false;
export function warnIfIpAllowlistTrustsXff(allowlist: readonly string[]): void {
    if (warned) return;
    if (allowlist.length === 0) return;
    warned = true;
    console.warn(
        "[admin] ADMIN_IP_ALLOWLIST is set. The gate trusts x-forwarded-for / x-real-ip; " +
            "verify that your edge proxy REPLACES (not appends to) inbound x-forwarded-for, " +
            "or remove ADMIN_IP_ALLOWLIST and rely on email + reauth.",
    );
}
