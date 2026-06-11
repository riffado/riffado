// Fail-closed CIDR allowlist matcher (IPv4 + IPv6, bare-IP = /32 or /128).

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let acc = 0;
    for (const p of parts) {
        const n = Number(p);
        if (!Number.isInteger(n) || n < 0 || n > 255) return null;
        acc = (acc << 8) + n;
    }
    return acc >>> 0;
}

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_16 = BigInt(16);
const BIG_V4_MASK = BigInt("0xffffffff");

function ipv6ToBigInt(ip: string): bigint | null {
    // Accepts IPv4-mapped form (::ffff:1.2.3.4).
    let s = ip;
    const v4Match = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (v4Match) {
        const v4 = ipv4ToInt(v4Match[2]);
        if (v4 === null) return null;
        const hi = (v4 >>> 16) & 0xffff;
        const lo = v4 & 0xffff;
        s = `${v4Match[1]}${hi.toString(16)}:${lo.toString(16)}`;
    }
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

/** Empty allowlist = disabled (true). Non-empty + no parseable entries = fail closed. */
export function ipMatchesAllowlist(
    clientIp: string | null | undefined,
    allowlist: readonly string[],
): boolean {
    if (allowlist.length === 0) return true;
    if (!clientIp) return false;

    let ip = clientIp.trim().replace(/^\[|\]$/g, "");
    if (ip.startsWith("::ffff:") && ip.includes(".")) {
        ip = ip.slice(7);
    }

    const parsedEntries = allowlist.flatMap((entry) => {
        const parsed = parseCidr(entry);
        return parsed ? [parsed] : [];
    });
    if (parsedEntries.length === 0) {
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
 * Client IP from XFF (first entry) or X-Real-IP. Trusts the headers —
 * the operator's proxy MUST replace (not append) inbound XFF. See
 * `warnIfIpAllowlistTrustsXff` startup warning.
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
