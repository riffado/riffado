"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
    { href: "/admin", label: "Overview" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/storage", label: "Storage" },
    { href: "/admin/transcription", label: "Transcription" },
    { href: "/admin/sync", label: "Sync" },
    { href: "/admin/exports", label: "Exports" },
    { href: "/admin/signups", label: "Signups" },
    { href: "/admin/billing", label: "Billing" },
    { href: "/admin/pricing-snapshot", label: "Pricing" },
    { href: "/admin/instance", label: "Instance" },
];

export function AdminNav() {
    const pathname = usePathname();
    return (
        <nav className="border-t bg-muted/30">
            <div className="max-w-7xl mx-auto px-6 flex items-center gap-1 overflow-x-auto">
                {ITEMS.map((item) => {
                    const active =
                        item.href === "/admin"
                            ? pathname === "/admin"
                            : pathname.startsWith(item.href);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "px-3 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap",
                                active
                                    ? "border-foreground text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {item.label}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
