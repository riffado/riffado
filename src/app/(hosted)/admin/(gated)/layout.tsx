import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { requireAdminPage } from "@/lib/hosted/admin/guard";
import { AdminNav } from "./_components/admin-nav";

function sanitizeAdminPath(p: string | null | undefined): string {
    // Only `/admin` exact or `/admin/<sub>` prefixes are valid; anything
    // else (or a missing header) collapses to `/admin`. This keeps the
    // audit label honest and prevents a forged `?next=` from bouncing
    // through to non-admin paths after reauth.
    if (!p) return "/admin";
    if (p === "/admin") return p;
    if (p.startsWith("/admin/") && !p.includes("..")) return p;
    return "/admin";
}

/**
 * Admin layout. Runs the gate on every render (server component, no caching).
 * On reauth-needed bounce to /admin/reauth?next=...; on hard failure the
 * gate calls notFound() before this code runs.
 *
 * Note: /admin/reauth has its own page-level gate (lighter -- doesn't require
 * the elevated cookie) and renders inside this layout group, so we must NOT
 * re-trigger the reauth bounce here for that specific path. Next.js layouts
 * don't easily know the current pathname, so /admin/reauth/page.tsx duplicates
 * the lightweight checks and we let the layout's full gate run elsewhere.
 *
 * To keep the reauth page renderable, we use a child-rendered wrapper that
 * skips the gate when the URL is /admin/reauth -- but server layouts can't
 * read pathname directly. Instead we put /admin/reauth OUTSIDE this layout
 * by giving it its own segment with a minimal layout. Done by colocating a
 * `layout.tsx` in /admin/reauth/ that overrides this one.
 */
export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Middleware sets `x-pathname` for every /admin/* request so the
    // layout audit row records the actual page (not a collapsed
    // "/admin") and the reauth bounce returns the user to the page they
    // asked for, not the dashboard root.
    const hdrs = await nextHeaders();
    const pathname = sanitizeAdminPath(hdrs.get("x-pathname"));
    const result = await requireAdminPage({
        route: pathname,
        method: "GET",
        returnTo: pathname,
    });

    if (result.mode === "reauth") {
        redirect(`/admin/reauth?next=${encodeURIComponent(result.returnTo)}`);
    }

    return (
        <div className="min-h-screen flex flex-col">
            <header className="border-b bg-background">
                <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <span className="font-semibold tracking-tight">
                            Riffado Admin
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                            hosted ops
                        </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                        {result.user.email}
                    </div>
                </div>
                <AdminNav />
            </header>
            <main className="flex-1 max-w-7xl w-full mx-auto p-6">
                {children}
            </main>
            <Toaster />
        </div>
    );
}
