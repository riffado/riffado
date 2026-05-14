import type { Metadata } from "next";
import Link from "next/link";

/*
 * TODO(legal): Replace this placeholder with the real privacy policy
 * before hosted GA. This is a structural stub so the footer's Privacy
 * link is not a dead link -- the content here is NOT a legal document
 * and must not be treated as one. Coordinate with counsel on:
 *   - Data controller / processor framing
 *   - Sub-processors (AI providers, S3 host, email, analytics)
 *   - International transfer mechanism (SCCs)
 *   - User rights (access, deletion, export -- export is already
 *     implemented via the full-backup endpoint)
 *   - Retention defaults and overrides
 *   - Cookie / tracking disclosure (Rybbit only, no third-party ads)
 *   - Contact for data requests (privacy@openplaud.com -- needs
 *     mailbox if we want to use it)
 */

export const metadata: Metadata = {
    title: "Privacy Policy — OpenPlaud",
    description: "How OpenPlaud handles your data on the hosted service.",
};

export default function PrivacyPage() {
    return (
        <>
            <h1>Privacy Policy</h1>
            <p>
                <em>Last updated: TBD. This page is a placeholder.</em>
            </p>
            <p>
                OpenPlaud is open-source software you can run yourself (under
                AGPL-3.0) or use through the hosted service at openplaud.com.
                This page describes how the hosted service handles your data. If
                you self-host, your data never touches our infrastructure and
                this policy does not apply to you. See the{" "}
                <Link href="https://github.com/openplaud/openplaud#readme">
                    project README
                </Link>{" "}
                for self-host guidance.
            </p>

            <h2>What we collect</h2>
            <p>
                Account information you provide (email, name), the Plaud account
                credentials you connect (encrypted at rest with AES-256-GCM),
                and the recordings, transcripts, and summaries the service
                generates on your behalf.
            </p>

            <h2>What we do not do</h2>
            <ul>
                <li>We do not train AI models on your recordings.</li>
                <li>We do not sell your data.</li>
                <li>
                    We do not share recordings with anyone other than the AI
                    provider you configure to transcribe and summarize them.
                </li>
            </ul>

            <h2>AI providers</h2>
            <p>
                When you configure an AI provider (OpenAI, Anthropic, Groq,
                OpenRouter, a local Ollama instance, etc.) the hosted service
                forwards the relevant audio or text to that provider on your
                behalf. Their privacy terms apply to that processing. We do not
                retain a separate copy of what we send to them beyond what is
                already stored in your account.
            </p>

            <h2>Export and deletion</h2>
            <p>
                You can export every recording, transcript, and summary from
                your account at any time via the full-backup endpoint. You can
                delete your account, which removes all associated data from
                active storage.
            </p>

            <h2>Compliance posture</h2>
            <p>
                OpenPlaud is not HIPAA or SOC 2 certified. For regulated work,
                self-host the project and plug in an AI provider that signs a
                BAA you have reviewed, or run a local model.
            </p>

            <h2>Contact</h2>
            <p>
                Questions about this policy:{" "}
                <Link href="mailto:support@openplaud.com">
                    support@openplaud.com
                </Link>
                . Security disclosures:{" "}
                <Link href="mailto:security@openplaud.com">
                    security@openplaud.com
                </Link>
                .
            </p>
        </>
    );
}
