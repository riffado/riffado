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
        version: "0.6.0",
        date: "2026-07-13",
        items: [
            {
                tag: "new",
                title: "Hosted Pro is live",
                body: "Choose the setup that works for you: let us run Riffado with Hosted Pro, or keep self-hosting the same open-source code for free. Hosted Pro includes a 14-day trial, 50 GB of encrypted storage, 15 hours of Mynah transcription each month, unlimited devices, and background sync. The first 100 paid monthly members can secure the founding price shown at checkout for as long as their subscription remains active.",
            },
            {
                tag: "new",
                title: "Take your complete library with you",
                body: "Create one backup archive containing every recording, transcript, and AI summary. Keep a complete portable copy of your library instead of exporting files one at a time.",
            },
            {
                tag: "new",
                title: "Transcribe privately in your browser",
                body: "Run Whisper on your own computer and save the finished transcript directly to Riffado. No API key or separate AI account is required.",
            },
            {
                tag: "new",
                title: "Use Google Gemini for transcription",
                body: "Gemini is now available alongside OpenAI, Groq, local models, and browser-based Whisper. Add your Gemini key in Settings and choose it for supported recordings.",
            },
            {
                tag: "improved",
                title: "Transcribe longer recordings",
                body: "Large recordings are automatically compressed for compatible cloud transcription providers, helping meeting-length audio fit provider upload limits without manual conversion.",
            },
            {
                tag: "fixed",
                title: "Get the full story from long meetings",
                body: "Summaries now use the complete transcript instead of silently stopping after the beginning. Decisions and action items near the end of a meeting are no longer left out.",
            },
            {
                tag: "fixed",
                title: "Reconnect Plaud without starting over",
                body: "When a Plaud connection expires, Riffado now guides you through reconnecting without deleting the connection or your existing recordings. Manual setup also rejects short-lived tokens that would stop working within a day.",
            },
            {
                tag: "improved",
                title: "Choose from more transcription languages",
                body: "The language picker now includes 18 more European and Asian languages, improving explicit language selection for short, noisy, or easily confused recordings.",
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
