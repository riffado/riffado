import { Footer } from "@/components/footer";
import { RebrandBanner } from "@/components/rebrand-banner";
import { Toaster } from "@/components/ui/sonner";
import { env } from "@/lib/env";

export default function AppLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <div className="flex flex-col min-h-[100vh]">
                {/* In-app rebrand banner. Hosted-only: existing OpenPlaud
                    users land here directly (auth redirect from `/`) and
                    would otherwise miss the announcement entirely. The
                    component itself self-expires; the layout gate keeps
                    self-host operators (who already know via GitHub) from
                    seeing chrome that doesn't apply to them. */}
                {env.IS_HOSTED ? <RebrandBanner /> : null}
                <main className="flex-1 flex flex-col">{children}</main>
                <Footer />
            </div>
            <Toaster />
        </>
    );
}
