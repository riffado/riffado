import { RebrandBanner } from "@/components/rebrand-banner";
import { Toaster } from "@/components/ui/sonner";
import { env } from "@/lib/env";

export default function AppLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            {env.IS_HOSTED ? <RebrandBanner /> : null}
            <main className="flex min-h-screen flex-col">{children}</main>
            <Toaster />
        </>
    );
}
