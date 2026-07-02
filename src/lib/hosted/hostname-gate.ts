export type GateDecision =
    | { kind: "next" }
    | { kind: "not-found" }
    | { kind: "redirect"; to: string };

const ADMIN_ONLY_PREFIXES = ["/admin", "/api/admin"] as const;

const ADMIN_HOST_SHARED_PREFIXES = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/api/auth",
    "/api/health",
    "/api/stripe",
] as const;

function pathStartsWith(
    pathname: string,
    prefixes: readonly string[],
): boolean {
    return prefixes.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

function isAdminPath(pathname: string): boolean {
    return pathStartsWith(pathname, ADMIN_ONLY_PREFIXES);
}

function isAdminHostShared(pathname: string): boolean {
    return pathStartsWith(pathname, ADMIN_HOST_SHARED_PREFIXES);
}

interface GateInput {
    requestHostname: string;
    pathname: string;
    adminHostname: string | undefined;
}

/**
 * Decide how the top-level middleware should respond to a request
 * based on the configured admin hostname.
 */
export function decideHostnameGate(input: GateInput): GateDecision {
    const { requestHostname, pathname, adminHostname } = input;

    if (!adminHostname) return { kind: "next" };

    const onAdminHost = requestHostname === adminHostname;
    const adminPath = isAdminPath(pathname);

    if (adminPath && !onAdminHost) return { kind: "not-found" };

    if (onAdminHost) {
        if (pathname === "/") return { kind: "redirect", to: "/admin" };
        if (adminPath || isAdminHostShared(pathname)) return { kind: "next" };
        return { kind: "not-found" };
    }

    return { kind: "next" };
}
