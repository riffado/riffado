import { createHash } from "node:crypto";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AdminInstancePage() {
    // Encryption-key fingerprint: HMAC of a known string would be ideal, but
    // a simple SHA-256 prefix of the raw key is enough as an identity marker
    // (we never display the key itself). 8 hex chars = 32 bits of identity --
    // sufficient to spot key rotation, useless for inversion.
    const keyFp = env.ENCRYPTION_KEY
        ? createHash("sha256")
              .update(env.ENCRYPTION_KEY)
              .digest("hex")
              .slice(0, 8)
        : "(unset)";
    const authFp = env.BETTER_AUTH_SECRET
        ? createHash("sha256")
              .update(env.BETTER_AUTH_SECRET)
              .digest("hex")
              .slice(0, 8)
        : "(unset)";

    const rows: Array<{ k: string; v: string }> = [
        { k: "Mode", v: env.IS_HOSTED ? "hosted" : "self-host" },
        { k: "Node env", v: process.env.NODE_ENV ?? "(unset)" },
        { k: "App URL", v: env.APP_URL ?? "(unset)" },
        { k: "Default storage", v: env.DEFAULT_STORAGE_TYPE },
        {
            k: "S3 endpoint",
            v: env.S3_ENDPOINT ?? "(local-only)",
        },
        { k: "SMTP", v: env.SMTP_HOST ? `set: ${env.SMTP_HOST}` : "unset" },
        {
            k: "Rybbit",
            v: env.RYBBIT_SITE_ID ? "configured" : "off",
        },
        { k: "Encryption key fingerprint", v: keyFp },
        { k: "Auth secret fingerprint", v: authFp },
        {
            k: "Admins",
            v:
                env.ADMIN_EMAILS.length > 0
                    ? `${env.ADMIN_EMAILS.length} configured`
                    : "(none)",
        },
        {
            k: "IP allowlist",
            v:
                env.ADMIN_IP_ALLOWLIST.length > 0
                    ? `${env.ADMIN_IP_ALLOWLIST.length} entries`
                    : "(disabled)",
        },
        {
            k: "Reauth TTL",
            v: `${env.ADMIN_REAUTH_TTL_MINUTES}m read / ${env.ADMIN_MUTATION_TTL_MINUTES}m mutate`,
        },
    ];

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold">Instance</h1>
                <p className="text-sm text-muted-foreground">
                    Operator-side environment summary. No secrets are printed,
                    only fingerprints.
                </p>
            </div>

            <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.k} className="border-t first:border-0">
                                <td className="px-3 py-2 text-muted-foreground w-64">
                                    {r.k}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs">
                                    {r.v}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
