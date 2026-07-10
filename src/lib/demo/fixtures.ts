import type { SummaryData } from "@/hooks/use-transcription-summary";
import {
    INITIAL_SETTINGS_DEFAULTS,
    type InitialSettings,
} from "@/lib/settings/initial-settings";
import type { Recording } from "@/types/recording";

/**
 * Hand-curated demo data for the `/dev/demo-dashboard` screenshot route.
 *
 * Everything in this module is fake. IDs are prefixed `demo-` so the
 * dev-only branch in `/api/recordings/[id]/summary` GET can recognize
 * them and serve `DEMO_SUMMARIES` without touching the DB. Never imported
 * by any non-dev code path.
 *
 * No real names of any real person. AI-provider strings match the
 * vendors we already name in marketing (`TheMath`, `Features`) so the
 * screenshots stay consistent with the rest of the landing.
 */

interface TranscriptionFixture {
    text: string;
    language?: string;
}

interface DemoRecordingSeed {
    id: string;
    filename: string;
    /** Seconds. */
    duration: number;
    /** Bytes. Realistic-ish: ~64 kbps mono m4a ≈ 8 kB/s. */
    filesize: number;
    /** Minutes before `now`. Lets the relative formatter render variety. */
    minutesAgo: number;
    deviceSn: string;
    transcript?: string;
    /** Optional ISO-639-1 detected language. Defaults to "en" when transcript is set. */
    language?: string;
    summary?: SummaryData;
}

const DEMO_DEVICE_SN = "PLA-NTP-DEMO-0001";

/**
 * Deterministic pseudo-random peaks in [0, 1]. Seeded by recording id +
 * index so each recording has a distinct, stable waveform shape across
 * re-renders. Density (256) sits above the waveform's MAX_VISIBLE_BARS
 * (220) so the aggregator gets real material to work with.
 */
function deterministicPeaks(seed: string, count = 256): number[] {
    // FNV-1a-ish 32-bit hash. Good enough for visual variety.
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const peaks: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
        // Mulberry32 step seeded off (h ^ i).
        let t = (h + i * 0x6d2b79f5) | 0;
        t = Math.imul(t ^ (t >>> 15), 1 | t);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        // Shape envelope: gentle attack + decay so the waveform looks
        // like speech, not white noise. Pure cosmetic.
        const envelope =
            0.55 +
            0.45 * Math.sin((i / count) * Math.PI) +
            0.15 * Math.sin((i / count) * Math.PI * 6.7);
        const v = (0.25 + r * 0.75) * Math.min(1, Math.max(0.25, envelope));
        peaks[i] = Math.min(1, Math.max(0.05, v));
    }
    return peaks;
}

const SEEDS: DemoRecordingSeed[] = [
    {
        id: "demo-q4-board-meeting",
        filename: "Q4 board meeting.m4a",
        duration: 23 * 60 + 41,
        filesize: 11_400_000,
        minutesAgo: 35,
        deviceSn: DEMO_DEVICE_SN,
        transcript: [
            "[00:00] Alright, let's get the Q4 review going. I want to leave the last fifteen minutes for next quarter planning, so we'll move quickly through the numbers.",
            "[00:18] Revenue closed at four point one million, up eighteen percent quarter on quarter. New contracts contributed roughly seven hundred thousand, the rest is expansion on existing accounts.",
            "[00:42] Gross margin is holding at seventy-three percent. Infra spend ticked up two points after the migration but we expect that to settle by mid Q1.",
            "[01:09] Churn dipped to two point one percent monthly, which is the best we've posted all year. Support tickets are down across the board since the migration shipped — Priya, you want to add color there?",
            "[01:31] Yeah, ticket volume is down roughly thirty percent week over week. Most of what's left is integration questions, not bugs. Time-to-first-response is under six minutes now, which puts us inside the SLA we promised the enterprise tier.",
            "[02:04] Good. On hiring — we closed three of the four open roles. The staff engineer search is still open; we have two finalists this week.",
            "[02:28] Let's lock the launch date for the next release before we wrap. I want to ship before the holiday freeze, which means code-complete by December eleventh.",
            "[02:51] I'll commit to that on the engineering side as long as we get sign-off on the export-format spec by Friday. Otherwise we're rolling that into Q1.",
            "[03:14] Fine, Friday is the deadline. Let's move on to the Q1 plan…",
        ].join("\n"),
        summary: {
            summary:
                "Q4 closed strong: revenue $4.1M (+18% QoQ), gross margin 73%, churn at a yearly low of 2.1% monthly. The post-migration support load dropped ~30% WoW and the team is inside the enterprise SLA. Three of four open roles closed; staff-engineer search continues. The next release is targeted to ship before the holiday freeze, contingent on the export-format spec being signed off by Friday.",
            keyPoints: [
                "Revenue $4.1M, up 18% QoQ; ~$700K from new logos, rest from expansion.",
                "Gross margin holding at 73% despite a two-point post-migration infra bump.",
                "Monthly churn at 2.1% — lowest of the year; enterprise SLA met.",
                "3 of 4 open roles closed; staff engineer down to two finalists.",
            ],
            actionItems: [
                "Engineering: hit code-complete on the next release by Dec 11.",
                "Product: sign off on the export-format spec by Friday.",
                "Support: keep weekly TTR report going into Q1 planning.",
            ],
            provider: "groq",
            model: "llama-3.1-70b-versatile",
        },
    },
    {
        id: "demo-priya-1on1",
        filename: "1-on-1 — Priya.m4a",
        duration: 47 * 60 + 12,
        filesize: 22_600_000,
        minutesAgo: 60 * 4 + 12,
        deviceSn: DEMO_DEVICE_SN,
        transcript: [
            "[00:00] How was the week? You mentioned wanting to talk through the on-call rotation, let's start there.",
            "[00:14] Yeah, the rotation's basically working but I want to revisit the escalation policy. Last Tuesday we had a P2 that should have paged me and didn't — alert fired but routing rules dropped it.",
            "[00:38] Got it. Let's pull the alert config together this week and walk through it. What's the second thing?",
            "[01:02] Career stuff. I'd like to start scoping the next staff project. I was thinking the export pipeline rewrite, but I want to validate it's actually the right thing before I commit a quarter to it.",
            "[01:31] That's a good instinct. Let's set up time with the product side this week to pressure-test the scope.",
        ].join("\n"),
    },
    {
        id: "demo-acme-customer-interview",
        filename: "Customer interview — Acme Corp.m4a",
        duration: 32 * 60 + 8,
        filesize: 15_400_000,
        minutesAgo: 60 * 22,
        deviceSn: DEMO_DEVICE_SN,
        transcript: [
            "[00:00] Thanks for taking the time. Before we dive in — anything off-limits, or are we good across the board?",
            "[00:09] We're good across the board. The legal team already signed off, so ask whatever you want.",
            "[00:18] Perfect. Tell me how you ended up choosing us — walk me through the last sixty days before you signed.",
            "[00:34] Honestly, it came down to two things. First, the API actually matched the docs, which sounds like a low bar but you'd be shocked. Second, our security team got their answers in under a week, which is unheard of for our procurement process.",
            "[01:08] What were you using before?",
            "[01:14] We had a homegrown thing on top of an open-source library, and a paid tool that was supposed to replace it but never really got rolled out. Two systems, neither working end-to-end.",
            "[01:42] If you could change one thing about the first thirty days with us, what would it be?",
            "[01:55] The onboarding emails are too dense. I'd send fewer of them, shorter. The product itself was fine — we were productive day three.",
        ].join("\n"),
        summary: {
            summary:
                "Acme chose us on two specific signals: API parity with the docs, and a sub-week turnaround on security questionnaires. They were replacing a stack of one homegrown OSS-based tool plus an unrolled paid product. They reached productive use on day three. Main onboarding friction: too many, too long welcome emails — they want fewer and shorter.",
            keyPoints: [
                "API/docs parity was the lead technical signal in the eval.",
                "Sub-week security questionnaire turnaround was the lead procurement signal.",
                "Replaced a homegrown OSS stack + a never-rolled-out paid competitor.",
                "Productive on day three; product onboarding itself was fine.",
            ],
            actionItems: [
                "Trim the welcome email sequence: fewer sends, shorter copy.",
                "Capture the security-questionnaire-turnaround claim for the sales deck.",
            ],
            provider: "openai",
            model: "gpt-4o-mini",
        },
    },
    {
        id: "demo-eng-standup",
        filename: "Engineering standup.m4a",
        duration: 14 * 60 + 22,
        filesize: 6_900_000,
        minutesAgo: 60 * 26,
        deviceSn: DEMO_DEVICE_SN,
        transcript: [
            "[00:00] Going around. Sam, you start.",
            "[00:03] Yesterday I finished the storage adapter refactor. Today, code review on the migration PR and starting the export-format spec. No blockers.",
            "[00:21] Cool. Priya?",
            "[00:24] Yesterday, on-call retro plus the rate-limit fix. Today, paging policy audit and one-on-one prep. Blocked on the alert config — need access from infra.",
            "[00:44] I'll ping infra after standup. Marc?",
            "[00:48] Yesterday I shipped the playback-speed setting. Today I'm picking up the keyboard-shortcuts dialog. No blockers.",
        ].join("\n"),
    },
    {
        id: "demo-pricing-memo",
        filename: "Voice memo — pricing ideas.m4a",
        duration: 3 * 60 + 47,
        filesize: 1_800_000,
        minutesAgo: 60 * 48,
        deviceSn: DEMO_DEVICE_SN,
        transcript: [
            "[00:00] OK pricing braindump, walking home. Three ideas.",
            "[00:08] One: usage-based on transcription minutes, not seats. Aligns the bill with the underlying AI cost. Downside, harder to forecast for the buyer.",
            "[00:32] Two: flat seats with a generous minute pool, overage at cost. Easier to forecast, but we eat the variance.",
            "[00:51] Three: hybrid. Flat seat fee plus a per-minute meter that resets monthly. Probably the right answer but the messaging is harder.",
            "[01:14] Action: pull the last three months of usage data, see what the bill would look like under each model for our top twenty accounts.",
        ].join("\n"),
    },
    {
        id: "demo-sequoia-call",
        filename: "Investor call (Sequoia).m4a",
        duration: 51 * 60 + 30,
        filesize: 24_700_000,
        minutesAgo: 60 * 24 * 3 + 60 * 2,
        deviceSn: DEMO_DEVICE_SN,
        // Intentionally no transcript — exercises the "not yet transcribed"
        // affordance in the list row + detail pane.
    },
    {
        id: "demo-walk-q1-plan",
        filename: "Walk and think — Q1 plan.m4a",
        duration: 18 * 60 + 55,
        filesize: 9_100_000,
        minutesAgo: 60 * 24 * 5 + 60 * 4,
        deviceSn: DEMO_DEVICE_SN,
        transcript: [
            "[00:00] Walking, Q1 plan, thinking out loud.",
            "[00:05] Top of the list is the export pipeline rewrite — that unblocks the enterprise contracts that need full-archive guarantees.",
            "[00:24] Second is the device-support expansion. We've been Plaud-only long enough; one more device family in Q1 is the right shape.",
            "[00:48] Third, billing. We have to get usage-based pricing live before we ship the hybrid plan, even if it just runs alongside seats for a quarter.",
        ].join("\n"),
    },
    {
        id: "demo-family-sunday",
        filename: "Family — Sunday.m4a",
        duration: 8 * 60 + 13,
        filesize: 3_950_000,
        minutesAgo: 60 * 24 * 11,
        deviceSn: DEMO_DEVICE_SN,
        // No transcript — and a non-work filename, on purpose: real users
        // capture both. Keeps the demo honest about what the product is for.
    },
];

function isoMinutesAgo(now: Date, minutesAgo: number): string {
    return new Date(now.getTime() - minutesAgo * 60_000).toISOString();
}

/**
 * Build the demo `Recording[]` for the workstation. `now` is taken as a
 * parameter so callers can render at a deterministic instant if they
 * ever need pixel-stable screenshots; in normal use the page passes
 * `new Date()` at request time.
 */
export function buildDemoRecordings(now: Date): Recording[] {
    return SEEDS.map((seed) => ({
        id: seed.id,
        filename: seed.filename,
        duration: seed.duration,
        filesize: seed.filesize,
        startTime: isoMinutesAgo(now, seed.minutesAgo),
        deviceSn: seed.deviceSn,
        filetagId: null,
        hasTranscript: !!seed.transcript,
        hasSummary: !!seed.summary,
        waveformPeaks: deterministicPeaks(seed.id),
    }));
}

/**
 * Demo transcriptions Map, keyed by recording id. Shape matches the
 * `transcriptions` prop on `<Workstation>`.
 */
export function buildDemoTranscriptions(): Map<string, TranscriptionFixture> {
    const map = new Map<string, TranscriptionFixture>();
    for (const seed of SEEDS) {
        if (seed.transcript) {
            map.set(seed.id, {
                text: seed.transcript,
                language: seed.language ?? "en",
            });
        }
    }
    return map;
}

/**
 * Demo summaries, keyed by recording id. Consumed by the dev-only
 * branch in `/api/recordings/[id]/summary` GET.
 */
export const DEMO_SUMMARIES: Map<string, SummaryData> = new Map(
    SEEDS.filter((s): s is DemoRecordingSeed & { summary: SummaryData } =>
        Boolean(s.summary),
    ).map((s) => [s.id, s.summary]),
);

/**
 * True when an id belongs to the demo set. The summary route uses this
 * to decide whether to short-circuit; never call without also gating
 * on `process.env.NODE_ENV !== "production"`.
 */
export function isDemoRecordingId(id: string): boolean {
    return id.startsWith("demo-");
}

/**
 * Demo `InitialSettings`. Built on top of the real defaults so any new
 * setting added in `initial-settings.ts` flows through automatically.
 * Overrides:
 *   - autoSyncEnabled / syncOnMount / syncOnVisibilityChange: false
 *     (the demo page must never fire an outbound `/api/sync` call).
 *   - syncNotifications / browserNotifications: false (no toasts or
 *     prompts pollute screenshots).
 *   - listDensity: comfortable, dateTimeFormat: relative (the
 *     visually-richer defaults).
 */
export const DEMO_INITIAL_SETTINGS: InitialSettings = {
    ...INITIAL_SETTINGS_DEFAULTS,
    autoSyncEnabled: false,
    syncOnMount: false,
    syncOnVisibilityChange: false,
    syncNotifications: false,
    browserNotifications: false,
    listDensity: "comfortable",
    dateTimeFormat: "relative",
};
