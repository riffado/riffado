import type { Metadata } from "next";
import Link from "next/link";

/*
 * TODO(legal): Replace this placeholder with the real terms of service
 * before hosted GA. This is a structural stub so the footer's Terms
 * link is not a dead link -- the content here is NOT a legal document
 * and must not be treated as one. Coordinate with counsel on:
 *   - Acceptable use (no automated abuse, no illegal content,
 *     recording-consent requirements vary by jurisdiction)
 *   - Account termination / suspension grounds
 *   - Subscription, billing, refund terms (once billing lands)
 *   - Disclaimer of warranties / limitation of liability
 *   - Governing law and dispute resolution
 *   - DMCA / takedown contact
 *   - Relationship to the AGPL-3.0 license that governs the software
 *     itself (the software is AGPL; the hosted service is a service
 *     under these terms -- these are independent contracts)
 */

export const metadata: Metadata = {
    title: "Terms of Service — Riffado",
    description:
        "Terms governing your use of the hosted Riffado service at riffado.com.",
};

export default function TermsPage() {
    return (
        <>
            <h1>Terms of Service</h1>
            <p>
                <em>Last updated: TBD. This page is a placeholder.</em>
            </p>
            <p>
                These terms govern your use of the hosted Riffado service at
                riffado.com. If you self-host the project, your relationship is
                with the AGPL-3.0 license that governs the source code, not with
                these terms.
            </p>

            <h2>The software vs. the service</h2>
            <p>
                The Riffado source code is licensed under AGPL-3.0 and lives at{" "}
                <Link
                    href="https://github.com/riffado/riffado"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    github.com/riffado/riffado
                </Link>
                . You are free to run, modify, and redistribute it under the
                terms of that license. These Terms of Service apply only to the
                hosted instance we operate.
            </p>

            <h2>Acceptable use</h2>
            <p>
                You may not use the service to process content you do not have
                the right to record or process. Recording-consent laws vary by
                jurisdiction; you are responsible for complying with the laws
                that apply to you and to the people in your recordings.
            </p>

            <h2>Your data</h2>
            <p>
                You own the recordings, transcripts, and summaries you bring to
                or generate through the service. You can export everything at
                any time via the full-backup endpoint.
            </p>

            <h2>No warranty</h2>
            <p>
                The service is provided as-is. Sync depends on Plaud&apos;s
                upstream API; AI features depend on the provider you configure.
                We do our best to keep the service running and will communicate
                outages, but we make no uptime guarantees on the hosted service
                at this stage.
            </p>

            <h2>Changes</h2>
            <p>
                We may update these terms. Material changes will be announced
                before they take effect.
            </p>

            <h2>Contact</h2>
            <p>
                <Link href="mailto:support@riffado.com">
                    support@riffado.com
                </Link>
            </p>
        </>
    );
}
