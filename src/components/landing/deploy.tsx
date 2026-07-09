import { Check, Terminal } from "lucide-react";
import Link from "next/link";
import { CopyableCommand } from "@/components/copyable-command";
import { INSTALL_ONELINER } from "@/lib/install-commands";

/**
 * Self-host section that follows `Pricing`. Argues the self-host tier
 * one more time, in detail, for readers who skipped past the pricing
 * card -- and gives them a real way to act on it (copyable install
 * one-liner + Deploy CTA + source link).
 *
 * Design rules (read before editing):
 *
 * - Surface is `bg-secondary/10 border-y` -- same as `TheMath` above
 *   Pricing. Deliberately NOT the dark `bg-auth-brand` surface that
 *   `FinalCTA` uses; the page would otherwise have two near-identical
 *   dark warm-sepia sections sandwiching `FAQ`, and `FinalCTA` is
 *   meant to be the unique dark closer.
 *
 * - Visual rhyme with `Pricing` is intentional: same eyebrow type
 *   treatment, same `Check` icons on the proof list. The two sections
 *   read as one argument about self-host -- price card on top,
 *   install proof underneath.
 *
 * - No primary button in this section. The Self-host pricing tier
 *   card directly above already has a `Deploy with Docker` button to
 *   `/install`; repeating it here was a redundant CTA at the same
 *   visual weight, ~200px apart. Per the landing CTA ladder, only
 *   Hero / Pricing / FinalCTA carry primary asks. Deploy's job here
 *   is proof, not a second ask -- the only inline link points to
 *   `/install` as a quiet anchor for readers who scrolled past
 *   Pricing.
 *
 * - The terminal shows the REAL documented install path
 *   (`INSTALL_ONELINER` from `src/lib/install-commands.ts`), copyable
 *   via `CopyableCommand`. Do not replace it with a fake
 *   `git clone / cd / docker compose up` script -- that's not the
 *   documented self-host flow. See `/install` page and
 *   `scripts/install.sh` for the canonical contract.
 *
 * - Proof points only claim what the code delivers today: AGPL on
 *   GitHub, no telemetry / no license server, pluggable storage
 *   (local or any S3-compatible bucket), pluggable AI (including
 *   browser Whisper and Ollama). No invented quotas, no compliance
 *   claims we don't own. Mirrors the Self-host tier features in
 *   `pricing.tsx` 1:1 so the two surfaces stay consistent.
 *
 * - `id="deploy"` is referenced by `/install` "← Back to landing"
 *   (`/#deploy`). Keep the id.
 */

const PROOF_POINTS = [
    "AGPL-3.0, full source on GitHub, no proprietary fork",
    "No telemetry, no phone home, no license server",
    "Local disk, or push to Cloudflare R2, Backblaze B2, or AWS S3",
    "Bring OpenAI or Groq for cloud transcription, or run Whisper and Ollama locally",
];

export function Deploy() {
    return (
        <section
            id="deploy"
            className="relative overflow-hidden border-y border-border/40 bg-secondary/10 py-24 md:py-32"
        >
            <div className="container mx-auto px-4 relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center max-w-6xl mx-auto">
                    <div className="space-y-6">
                        <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-mono uppercase tracking-wider text-muted-foreground">
                            <Terminal className="mr-2 size-3" aria-hidden />
                            Self-host, if you want to
                        </div>
                        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-balance">
                            One command. Your server. Yours forever.
                        </h2>
                        <p className="text-muted-foreground text-lg leading-relaxed text-pretty">
                            Riffado ships as a Docker Compose stack: the app, a
                            database, your storage. Move from Hosted whenever
                            you want via full-archive export. Same source, your
                            machine.
                        </p>

                        <ul className="space-y-3 pt-2">
                            {PROOF_POINTS.map((point) => (
                                <li
                                    key={point}
                                    className="flex items-start gap-2.5 text-sm leading-snug"
                                >
                                    <Check
                                        className="size-4 mt-0.5 shrink-0 text-muted-foreground"
                                        aria-hidden
                                    />
                                    <span>{point}</span>
                                </li>
                            ))}
                        </ul>

                        <p className="pt-2 text-sm">
                            <Link
                                href="/install"
                                className="font-mono text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground transition-colors"
                            >
                                Deploy with Docker →
                            </Link>
                        </p>
                    </div>

                    <div className="w-full space-y-4">
                        <CopyableCommand
                            command={INSTALL_ONELINER}
                            ariaLabel="Copy install command"
                        />

                        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
                            <div className="px-4 py-2.5 border-b border-border bg-background/40">
                                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                                    Installer output
                                </div>
                            </div>
                            <div className="p-5 md:p-6 font-mono text-xs md:text-sm leading-relaxed text-muted-foreground space-y-1.5">
                                <div>
                                    <span className="text-green-600 dark:text-green-500">
                                        ✓
                                    </span>{" "}
                                    Verified Docker + Compose v2
                                </div>
                                <div>
                                    <span className="text-green-600 dark:text-green-500">
                                        ✓
                                    </span>{" "}
                                    Wrote .env (secrets generated)
                                </div>
                                <div>
                                    <span className="text-green-600 dark:text-green-500">
                                        ✓
                                    </span>{" "}
                                    Pulled riffado-web, riffado-db
                                </div>
                                <div>
                                    <span className="text-green-600 dark:text-green-500">
                                        ✓
                                    </span>{" "}
                                    Health check passed on /api/health
                                </div>
                                <div className="pt-1.5 text-foreground">
                                    →{" "}
                                    <span className="font-medium">
                                        http://localhost:3000
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
