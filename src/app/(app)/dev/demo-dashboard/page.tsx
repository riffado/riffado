import { notFound } from "next/navigation";
import { Workstation } from "@/components/dashboard/workstation";
import { requireAuth } from "@/lib/auth-server";
import {
    buildDemoRecordings,
    buildDemoTranscriptions,
    DEMO_INITIAL_SETTINGS,
} from "@/lib/demo/fixtures";
import { env } from "@/lib/env";

/**
 * Dev-only screenshot route.
 *
 * Renders the real `<Workstation>` against hand-curated fixtures from
 * `src/lib/demo/fixtures.ts`. Used to capture marketing screenshots
 * without polluting a real user account with demo data.
 *
 * Two gates, both required:
 *   1. `process.env.NODE_ENV !== "production"` -- production builds
 *      return 404 from this route. Belt: the page literally doesn't
 *      exist server-side in prod.
 *   2. `await requireAuth()` -- must be logged in. Suspenders: a
 *      misconfigured deploy that somehow ships dev artefacts still
 *      can't expose this anonymously.
 *
 * Audio playback is intentionally broken in this view -- the player's
 * `src={/api/recordings/${id}/audio}` will 404 for `demo-` ids. That's
 * fine for static screenshots; the waveform, transcript, and summary
 * UI all render from props/fixtures without needing the audio buffer.
 *
 * Summaries are served by a dev-only branch at the top of
 * `/api/recordings/[id]/summary` GET which recognizes `demo-` ids.
 */
export default async function DemoDashboardPage() {
    if (process.env.NODE_ENV === "production") {
        notFound();
    }

    const session = await requireAuth();

    const recordings = buildDemoRecordings(new Date());
    const transcriptions = buildDemoTranscriptions();

    return (
        <Workstation
            recordings={recordings}
            transcriptions={transcriptions}
            filetags={[]}
            isAdmin={false}
            userEmail={session.user.email ?? null}
            initialSettings={DEMO_INITIAL_SETTINGS}
            plaudNeedsReconnect={false}
            isHosted={env.IS_HOSTED}
        />
    );
}
