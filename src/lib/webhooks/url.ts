import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type PublicWebhookAddress = {
    address: string;
    family: 4 | 6;
};

export type PublicWebhookTarget = {
    url: URL;
    addresses: PublicWebhookAddress[];
};

function assertHttpsWebhookUrl(url: URL): void {
    if (url.protocol !== "https:") {
        throw new Error("Webhook URL must use HTTPS");
    }
}

export function parseWebhookUrl(value: unknown): string {
    if (typeof value !== "string") throw new Error("URL is required");

    const trimmed = value.trim();
    const url = new URL(trimmed);
    assertHttpsWebhookUrl(url);
    if (url.username || url.password) {
        throw new Error("Webhook URL must not include credentials");
    }
    assertAllowedWebhookHostname(url.hostname);
    return url.toString();
}

function normalizedHostname(hostname: string): string {
    const lower = hostname.toLowerCase().replace(/\.$/, "");
    if (lower.startsWith("[") && lower.endsWith("]")) {
        return lower.slice(1, -1);
    }
    return lower;
}

function parseIpv4(address: string): [number, number, number, number] | null {
    const parts = address.split(".").map((part) => Number.parseInt(part, 10));
    if (
        parts.length !== 4 ||
        parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
        return null;
    }
    return [parts[0], parts[1], parts[2], parts[3]];
}

function isPrivateIpv4(address: string): boolean {
    const parts = parseIpv4(address);
    if (!parts) return true;

    const [a, b, c] = parts;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0 && (c === 0 || c === 2)) ||
        (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113) ||
        a >= 224
    );
}

function firstIpv6Hextets(address: string): [number, number] {
    const [first = "0", second = "0"] = address.split(":");
    return [
        first ? Number.parseInt(first, 16) : 0,
        second ? Number.parseInt(second, 16) : 0,
    ];
}

function mappedIpv4FromIpv6(address: string): string | null {
    const dottedIpv4 = address.includes(".")
        ? address.slice(address.lastIndexOf(":") + 1)
        : null;
    if (dottedIpv4 && parseIpv4(dottedIpv4)) return dottedIpv4;

    const tail = address.startsWith("::ffff:")
        ? address.slice("::ffff:".length)
        : address.startsWith("0:0:0:0:0:ffff:")
          ? address.slice("0:0:0:0:0:ffff:".length)
          : null;
    if (!tail) return null;

    const parts = tail.split(":");
    if (parts.length !== 2) return null;

    const high = Number.parseInt(parts[0], 16);
    const low = Number.parseInt(parts[1], 16);
    if (
        !Number.isInteger(high) ||
        !Number.isInteger(low) ||
        high < 0 ||
        high > 0xffff ||
        low < 0 ||
        low > 0xffff
    ) {
        return null;
    }

    return [
        (high >> 8) & 0xff,
        high & 0xff,
        (low >> 8) & 0xff,
        low & 0xff,
    ].join(".");
}

function isPrivateIpv6(address: string): boolean {
    const normalized = address.toLowerCase().split("%", 1)[0];
    const mappedIpv4 = mappedIpv4FromIpv6(normalized);

    if (mappedIpv4) {
        return isPrivateIpv4(mappedIpv4);
    }
    if (normalized === "::" || normalized === "::1") return true;

    const [first, second] = firstIpv6Hextets(normalized);
    return (
        (first & 0xfe00) === 0xfc00 ||
        (first & 0xffc0) === 0xfe80 ||
        (first & 0xff00) === 0xff00 ||
        (first === 0x2001 && second === 0x0db8)
    );
}

function isPrivateIpAddress(address: string): boolean {
    const normalized = normalizedHostname(address);
    const ipVersion = isIP(normalized);
    if (ipVersion === 4) return isPrivateIpv4(normalized);
    if (ipVersion === 6) return isPrivateIpv6(normalized);
    return false;
}

function assertAllowedWebhookHostname(hostname: string): void {
    const normalized = normalizedHostname(hostname);
    if (
        normalized === "localhost" ||
        normalized.endsWith(".localhost") ||
        normalized.endsWith(".local") ||
        normalized.endsWith(".internal") ||
        normalized.endsWith(".home.arpa") ||
        normalized.endsWith(".lan") ||
        isPrivateIpAddress(normalized)
    ) {
        throw new Error("Webhook URL must use a public hostname or IP address");
    }
}

export async function assertPublicWebhookUrl(urlString: string): Promise<void> {
    await resolvePublicWebhookUrl(urlString);
}

export async function resolvePublicWebhookUrl(
    urlString: string,
): Promise<PublicWebhookTarget> {
    const url = new URL(urlString);
    assertHttpsWebhookUrl(url);
    assertAllowedWebhookHostname(url.hostname);

    const hostname = normalizedHostname(url.hostname);
    const ipVersion = isIP(hostname);
    if (ipVersion === 4 || ipVersion === 6) {
        return {
            url,
            addresses: [{ address: hostname, family: ipVersion }],
        };
    }

    let addresses: Array<{ address: string; family: number }>;
    try {
        addresses = await lookup(hostname, {
            all: true,
            verbatim: true,
        } as const);
    } catch {
        throw new Error("Webhook URL host could not be resolved");
    }

    if (addresses.length === 0) {
        throw new Error("Webhook URL host could not be resolved");
    }
    if (addresses.some((address) => isPrivateIpAddress(address.address))) {
        throw new Error("Webhook URL must resolve to public IP addresses");
    }

    return {
        url,
        addresses: addresses.map((address) => ({
            address: address.address,
            family: address.family === 6 ? 6 : 4,
        })),
    };
}
