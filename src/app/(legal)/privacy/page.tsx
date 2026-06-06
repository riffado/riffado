import type { Metadata } from "next";
import Link from "next/link";
import {
    CONTACT_LINKS,
    EFFECTIVE_DATE_DISPLAY,
    LEGAL_ADDRESS_LINE,
    LEGAL_ENTITY,
    MIN_AGE,
    SUBPROCESSORS,
    SUPERVISORY_AUTHORITY,
} from "@/lib/legal/constants";

/*
 * Privacy policy for the HOSTED service only. The `(legal)` layout 404s
 * when `!IS_HOSTED`, so this never serves on a self-hosted instance.
 *
 * Structure follows the GDPR Article 13 information obligations: who the
 * controller is, what we process and why, the legal bases, recipients
 * (sub-processors), transfers, retention, data-subject rights, and the
 * right to lodge a complaint with the supervisory authority.
 *
 * Every factual claim here is traceable to code: AES-256-GCM token
 * encryption (`src/lib/encryption.ts`), full-archive export, account
 * deletion, self-hosted Rybbit analytics, user-configured AI providers.
 * Do not add claims the code does not back. Variable facts (entity,
 * address, sub-processors, contacts) come from `@/lib/legal/constants`.
 */

export const metadata: Metadata = {
    title: "Privacy Policy — Mesynx AI",
    description: "How the hosted Mesynx AI service handles your personal data.",
};

export default function PrivacyPage() {
    return (
        <>
            <h1>Privacy Policy</h1>
            <p>
                <em>Effective {EFFECTIVE_DATE_DISPLAY}.</em>
            </p>
            <p>
                This policy explains how we handle personal data on the hosted
                Mesynx AI service at mesynx.r0073dl053r.com. Mesynx AI is also
                open-source software you can run yourself under the AGPL-3.0
                license. If you self-host, your data never touches our
                infrastructure and this policy does not apply to you — see the{" "}
                <Link href="https://github.com/r0073d-l053r/mesynx#readme">
                    project README
                </Link>{" "}
                for self-host guidance.
            </p>

            <h2>Who we are</h2>
            <p>
                The hosted service is operated by {LEGAL_ENTITY.fullName} (
                {LEGAL_ENTITY.name}), {LEGAL_ENTITY.form}, with its registered
                office at {LEGAL_ADDRESS_LINE}, entered in the National Court
                Register (KRS) under number {LEGAL_ENTITY.krs} by the{" "}
                {LEGAL_ENTITY.registrationCourt}; NIP {LEGAL_ENTITY.nip}, REGON{" "}
                {LEGAL_ENTITY.regon}; share capital {LEGAL_ENTITY.shareCapital}.
                We are the data controller for the personal data described
                below. For privacy questions or to exercise your rights, open a
                thread on{" "}
                <Link
                    href={CONTACT_LINKS.privacy}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    GitHub Discussions
                </Link>
                .
            </p>

            <h2>What we collect</h2>
            <ul>
                <li>
                    <strong>Account data</strong> — the email address and name
                    you provide when you register, and authentication data
                    needed to sign you in.
                </li>
                <li>
                    <strong>Connected recorder credentials</strong> — the Plaud
                    account token you connect, stored encrypted at rest with
                    AES-256-GCM and decrypted only when we make a request to
                    Plaud on your behalf.
                </li>
                <li>
                    <strong>Your content</strong> — the recordings, transcripts,
                    and summaries the service syncs or generates for you.
                </li>
                <li>
                    <strong>Usage analytics</strong> — privacy-friendly,
                    aggregate usage data collected through analytics software we
                    host ourselves. It uses no advertising cookies and is not
                    shared with any third party.
                </li>
            </ul>

            <h2>Why we process it, and on what legal basis</h2>
            <ul>
                <li>
                    To provide the service — sync, transcription, storage, and
                    export — on the legal basis of performing our contract with
                    you (Art. 6(1)(b) GDPR).
                </li>
                <li>
                    To send transactional email (password resets, recording
                    notifications you enable), also as performance of the
                    contract.
                </li>
                <li>
                    To keep the service secure and working, and to understand
                    aggregate usage, on the basis of our legitimate interests
                    (Art. 6(1)(f) GDPR).
                </li>
                <li>
                    When you choose a cloud AI provider, to forward the relevant
                    audio or text to it at your direction so it can transcribe
                    or summarize your content.
                </li>
            </ul>

            <h2>What we do not do</h2>
            <ul>
                <li>We do not train AI models on your recordings.</li>
                <li>We do not sell your personal data.</li>
                <li>
                    We do not use advertising trackers or share data with ad
                    networks.
                </li>
            </ul>

            <h2>Who processes data for us</h2>
            <p>
                We use the following sub-processors to run the hosted service.
                Each handles personal data only on our instructions under a data
                processing agreement:
            </p>
            <div className="overflow-x-auto mb-4">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="border-b border-border text-left">
                            <th className="py-2 pr-4 font-semibold text-foreground">
                                Sub-processor
                            </th>
                            <th className="py-2 pr-4 font-semibold text-foreground">
                                Purpose
                            </th>
                            <th className="py-2 pr-4 font-semibold text-foreground">
                                Location
                            </th>
                            <th className="py-2 font-semibold text-foreground">
                                Safeguard
                            </th>
                        </tr>
                    </thead>
                    <tbody className="text-muted-foreground">
                        {SUBPROCESSORS.map((p) => (
                            <tr
                                key={p.name}
                                className="border-b border-border/40 align-top"
                            >
                                <td className="py-2 pr-4 text-foreground">
                                    {p.name}
                                </td>
                                <td className="py-2 pr-4">{p.purpose}</td>
                                <td className="py-2 pr-4">{p.location}</td>
                                <td className="py-2">{p.safeguard}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p>
                Our analytics software runs on our own infrastructure, so it is
                not a third-party recipient of your data.
            </p>

            <h2>AI providers you configure</h2>
            <p>
                When you configure a cloud AI provider (such as OpenAI,
                Anthropic, or Groq) the service forwards the relevant audio or
                text to that provider at your direction. You contract with that
                provider directly and their privacy terms govern that processing
                — they are not our sub-processors. We do not retain a separate
                copy beyond what is already stored in your account. If you
                transcribe in your browser or with a local model, no audio
                leaves your control through a third party at all.
            </p>

            <h2>International transfers</h2>
            <p>
                Most processing happens within the European Economic Area. Where
                a sub-processor is established outside the EEA (see the table
                above), transfers are covered by the EU Standard Contractual
                Clauses and the provider&apos;s data processing agreement.
            </p>

            <h2>Retention</h2>
            <p>
                We keep your content and account data for as long as your
                account is active. When you delete your account, we remove the
                associated data from active storage; residual copies in routine
                backups age out on the backup rotation. We keep the minimum
                records we are legally required to retain.
            </p>

            <h2>Your rights</h2>
            <p>
                Under the GDPR you have the right to access, rectify, erase,
                restrict, and object to the processing of your personal data,
                and the right to data portability. You can act on most of these
                yourself: export every recording, transcript, and summary at any
                time via the full-archive export, and delete your account to
                erase your data. For anything else, open a thread on{" "}
                <Link
                    href={CONTACT_LINKS.privacy}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    GitHub Discussions
                </Link>{" "}
                and we will respond within the time the GDPR allows.
            </p>
            <p>
                You also have the right to lodge a complaint with a supervisory
                authority. Our lead authority is {SUPERVISORY_AUTHORITY.name},{" "}
                {SUPERVISORY_AUTHORITY.address} (
                <Link href={SUPERVISORY_AUTHORITY.url}>
                    {SUPERVISORY_AUTHORITY.url.replace("https://", "")}
                </Link>
                ).
            </p>

            <h2>Security</h2>
            <p>
                Connected recorder tokens and other sensitive credentials are
                encrypted at rest with AES-256-GCM. Report suspected
                vulnerabilities via a{" "}
                <Link
                    href={CONTACT_LINKS.security}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    GitHub private security advisory
                </Link>
                .
            </p>

            <h2>Children</h2>
            <p>
                The hosted service is not directed to children. You must be at
                least {MIN_AGE} years old to use it; if you are under 18, you
                need a parent or guardian&apos;s consent.
            </p>

            <h2>Compliance posture</h2>
            <p>
                Mesynx AI is not HIPAA or SOC 2 certified. For regulated work,
                self-host the project and plug in an AI provider that signs a
                data processing agreement you have reviewed, or run a local
                model.
            </p>

            <h2>Changes</h2>
            <p>
                When we update this policy, we will post the new version here
                and update the effective date above. We encourage you to review
                it periodically.
            </p>

            <h2>Contact</h2>
            <p>
                Privacy and data requests:{" "}
                <Link
                    href={CONTACT_LINKS.privacy}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    GitHub Discussions
                </Link>
                . General support and questions:{" "}
                <Link
                    href={CONTACT_LINKS.support}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Discord
                </Link>
                .
            </p>
        </>
    );
}
