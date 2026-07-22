/**
 * Hosted-user-facing changelog.
 *
 * Hand-curated at release time by the maintainer, in parallel with the
 * technical `CHANGELOG.md` at the repo root. The two sources serve
 * different audiences:
 *
 *   - `CHANGELOG.md`     -- self-host operators + contributors. Carries
 *                           env vars, PR numbers, migration notes, and
 *                           internal refactors. Source of truth for
 *                           "what's running on my box".
 *   - `PUBLIC_CHANGELOG` -- hosted-instance users. Plain language, no
 *                           PR numbers, no env vars, no internal
 *                           refactors. Source of truth for "what
 *                           changed in the app I use".
 *
 * Structure mirrors `CHANGELOG.md`: one entry per release, each release
 * carrying its own dated bundle of items. This matches how releases
 * actually ship -- many user-visible changes land together under one
 * version tag -- and avoids the "May 15 -> May 15 -> May 15" repetition
 * that month-grouping produces when several features release on the
 * same day.
 *
 * Workflow on release:
 *   1. Move the technical entries from `[Unreleased]` to a new
 *      released version section in `CHANGELOG.md`.
 *   2. Prepend a new `PublicChangelogRelease` to `PUBLIC_CHANGELOG`
 *      with the version, date, and one plain-language item per
 *      hosted-user-visible change.
 *   3. Skip changes that are operator-only (admin dashboard internals,
 *      migration scripts, infra-only fixes that a user never knew
 *      were broken).
 *
 * Style guide for items:
 *   - Title: verb-led, plain language, no jargon ("See your recording
 *     as you listen", not "Waveform player with peak caching").
 *   - Body: 1-3 sentences. Name what the user gets, not how it works.
 *   - No PR numbers, no GitHub issue refs, no env var names.
 *   - Vendor names only when meaningful to the user ("Plaud") -- not
 *     for repetition.
 *   - Wrap keyboard shortcuts in backticks: `` `Cmd K` ``, `` `?` ``,
 *     `` `Ctrl Enter` ``. The page renders backticked spans as styled
 *     keyboard-key chips. Group keys pressed together inside one pair
 *     of backticks; use separate pairs for alternative shortcuts
 *     (`` `Cmd K` (or `Ctrl K`) ``).
 *
 * Rendered at `/changelog` (hosted-only). Self-host visitors to that
 * route are redirected to `CHANGELOG.md` on GitHub, which is the
 * accurate source for their installed version.
 */
export type PublicChangelogTag = "new" | "improved" | "fixed" | "news";

export type PublicChangelogItem = {
    tag: PublicChangelogTag;
    /** Short, verb-led, plain language. */
    title: string;
    /** 1-3 sentences. No jargon, no PR refs, no env vars. */
    body: string;
    /** Optional deeper link (docs page, help article). */
    link?: { href: string; label: string };
};

export type PublicChangelogRelease = {
    /**
     * Semver string without the `v` prefix, e.g. `"0.5.0"`.
     *
     * Not rendered on the page -- hosted users don't pick versions, so
     * the date is the user-meaningful unit. The field stays for the
     * maintainer's cross-reference with `CHANGELOG.md` (and for any
     * future per-version tooling) but never reaches the UI.
     */
    version: string;
    /** ISO YYYY-MM-DD. Drives sort order, the section heading, and the
     *  per-release anchor (`#YYYY-MM-DD`). */
    date: string;
    items: PublicChangelogItem[];
};

/**
 * Releases sorted newest-first at render time. Source order here is
 * not significant -- add new releases wherever; the page sorts.
 */
export const PUBLIC_CHANGELOG: PublicChangelogRelease[] = [
    {
        version: "0.6.2",
        date: "2026-07-21",
        items: [
            {
                tag: "fixed",
                title: "New accounts now actually see onboarding",
                body: "Onboarding could be silently skipped on first login. It now opens automatically and walks you through setup before you land on the dashboard.",
            },
            {
                tag: "improved",
                title: "A clearer next step after signup when email verification is on",
                body: 'You get an in-place "check your email" screen with a resend button, instead of bouncing back to the sign-in page.',
            },
        ],
    },
    {
        // v0.6.1 was a same-day Docker hotfix with no user-visible change; folded into this entry.
        version: "0.6.0",
        date: "2026-07-20",
        items: [
            {
                tag: "news",
                title: "Hosted Pro is live",
                body: "A managed plan for people who'd rather not run their own server: 50 GB of encrypted storage, 15 hours of included Mynah transcription every month, unlimited devices, and background sync. The first 100 people who subscribe monthly lock in founding-member pricing for as long as they stay subscribed.",
                link: { href: "/#pricing", label: "See Hosted Pro pricing" },
            },
            {
                tag: "new",
                title: "Back up everything in one archive",
                body: "Settings → Export & Backup now builds a complete archive of every recording's audio, transcript, and summary, so you always have a way out with everything intact.",
            },
            {
                tag: "new",
                title: "Google Gemini as a transcription provider",
                body: "Add a Gemini API key in Settings → Providers alongside OpenAI, Groq, and the rest.",
            },
            {
                tag: "new",
                title: "18 more transcription languages",
                body: "Added coverage across Central and Eastern Europe, the Nordics, the Middle East, South Asia, and Southeast Asia.",
            },
            {
                tag: "improved",
                title: "Large recordings transcribe more reliably",
                body: "Oversized audio is now compressed automatically instead of failing outright.",
            },
            {
                tag: "improved",
                title: "Browser transcription is more accurate",
                body: "Audio is properly resampled before Whisper processes it in your browser.",
            },
            {
                tag: "fixed",
                title: "Long recordings get complete summaries again",
                body: "Summaries previously cut off after about 8,000 characters of transcript. The full transcript is used now.",
            },
            {
                tag: "fixed",
                title: "GPT-5 and o-series models work for summaries",
                body: "Fixed a request format mismatch that broke summary generation on newer OpenAI models.",
            },
            {
                tag: "fixed",
                title: "Reconnecting your Plaud account no longer risks your recordings",
                body: "A stale or invalid token now offers a safe reconnect path that keeps your existing connection and recordings in place.",
            },
        ],
    },
    {
        // Standalone marketing-event entry, not tied to a code release.
        // The `version` field stays for the maintainer cross-reference
        // pattern but is not shown; the rebrand is dated, not versioned.
        version: "0.5.4-rebrand",
        date: "2026-05-29",
        items: [
            {
                tag: "news",
                title: "OpenPlaud is now Riffado",
                body: "Same project, same code, same team — new name. The old name tied us to a single vendor; Riffado is a name we can grow into. Your account, recordings, transcripts, settings, and API tokens all keep working unchanged.",
                link: { href: "/rebrand", label: "Read the full note" },
            },
        ],
    },
    {
        version: "0.5.0",
        date: "2026-05-15",
        items: [
            {
                tag: "new",
                title: "Jump anywhere with Cmd K",
                body: "Press `Cmd K` (or `Ctrl K`) from any screen to sync, upload, change settings, switch theme, or search across your recordings and transcripts. Press `?` to see every shortcut.",
            },
            {
                tag: "new",
                title: "See your recording as you listen",
                body: "The player now shows a waveform of your audio with a moving playhead and hover-to-preview timestamps. Click anywhere on the waveform to jump to that moment.",
            },
            {
                tag: "improved",
                title: "A faster, cleaner recordings list",
                body: "Recordings group by date, scroll endlessly, and show status at a glance — transcript ready, summary ready, in progress. Sort and density preferences are remembered between visits.",
            },
            {
                tag: "improved",
                title: "Settings, reorganized",
                body: "Settings now group into Providers, Plaud, Personalize, Data, Integrations, and Advanced. A new Storage view shows what's using space and which recordings are largest.",
            },
        ],
    },
    {
        version: "0.4.0",
        date: "2026-05-09",
        items: [
            {
                tag: "new",
                title: "Switch or disconnect your Plaud account",
                body: "A new Plaud Account section in Settings lets you switch to a different Plaud account or disconnect entirely. Your existing recordings stay where they are.",
            },
        ],
    },
    {
        version: "0.3.0",
        date: "2026-05-07",
        items: [
            {
                tag: "new",
                title: "Sign in to Plaud the way you normally do",
                body: "Use our browser extension to sign in to Plaud with Google, Apple, or your usual email and password — no more copying tokens by hand.",
            },
            {
                tag: "new",
                title: "Summaries in the language you choose",
                body: "Pick the language for AI-generated summaries and titles independently of the recording's language. Record in English, get a Spanish summary, or any combination.",
            },
            {
                tag: "new",
                title: "Reset your password by email",
                body: 'If you forget your password, click the new "Forgot password?" link on the sign-in screen to get a reset link by email.',
            },
            {
                tag: "new",
                title: "Delete a recording in one click",
                body: "Recordings can now be deleted directly from the workstation — hover a row, click the menu, confirm.",
            },
        ],
    },
];
