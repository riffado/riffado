import type { Metadata } from "next";
import Link from "next/link";
import {
    CONTACT_EMAILS,
    EFFECTIVE_DATE_DISPLAY,
    GOVERNING_LAW,
    LEGAL_ADDRESS_LINE,
    LEGAL_ENTITY,
    MIN_AGE,
} from "@/lib/legal/constants";

/*
 * Terms of Service for the HOSTED service only. The `(legal)` layout
 * 404s when `!IS_HOSTED`, so this never serves on a self-hosted instance.
 *
 * The operator is a Polish company, so this doubles as the "regulamin"
 * required of an electronic-service provider under the Polish Act on
 * Providing Services by Electronic Means: it identifies the provider,
 * the scope of services, technical conditions, the prohibition on
 * unlawful content, contract conclusion/termination, and a complaints
 * procedure. It also carries standard SaaS terms (acceptable use,
 * disclaimers, liability, governing law).
 *
 * Factual claims track the code: AGPL-3.0 source, full-archive export,
 * Plaud-upstream dependence, user-configured AI providers, paid Pro tier
 * via Stripe, 14-day trial, grace periods, account deletion. Variable
 * facts come from `@/lib/legal/constants`.
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
                <em>Effective {EFFECTIVE_DATE_DISPLAY}.</em>
            </p>
            <p>
                These terms govern your use of the hosted Riffado service at
                riffado.com. By creating an account or using the service, you
                agree to them. If you self-host the project instead, your
                relationship is with the AGPL-3.0 license that governs the
                source code, not with these terms.
            </p>

            <h2>Who provides the service</h2>
            <p>
                The hosted service is provided by {LEGAL_ENTITY.fullName} (
                {LEGAL_ENTITY.name}), {LEGAL_ENTITY.form}, registered office at{" "}
                {LEGAL_ADDRESS_LINE}, KRS {LEGAL_ENTITY.krs}, NIP{" "}
                {LEGAL_ENTITY.nip}, REGON {LEGAL_ENTITY.regon}, share capital{" "}
                {LEGAL_ENTITY.shareCapital}. You can reach us at{" "}
                <Link href={`mailto:${CONTACT_EMAILS.support}`}>
                    {CONTACT_EMAILS.support}
                </Link>
                .
            </p>

            <h2>What the service does</h2>
            <p>
                Riffado syncs recordings from a connected voice recorder,
                transcribes and summarizes them using the AI provider you choose
                (or in your browser), stores them, and lets you export
                everything. To use it you need a compatible browser, internet
                access, an account, and — for sync — a connected recorder
                account.
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
                . You are free to run, modify, and redistribute it under that
                license. These terms apply only to the hosted instance we
                operate; they are a separate agreement from the AGPL-3.0
                license.
            </p>

            <h2>Eligibility and accounts</h2>
            <p>
                You must be at least {MIN_AGE} years old to use the service; if
                you are under 18, you need a parent or guardian&apos;s consent.
                You are responsible for the activity under your account and for
                keeping your credentials secure.
            </p>

            <h2>Acceptable use</h2>
            <p>
                You may not use the service to process content you do not have
                the right to record or process, to break the law, or to disrupt
                or abuse the service or its infrastructure. Recording-consent
                laws vary by jurisdiction; you are responsible for complying
                with the laws that apply to you and to the people in your
                recordings.
            </p>

            <h2>Your content</h2>
            <p>
                You own the recordings, transcripts, and summaries you bring to
                or generate through the service. We claim no ownership of them.
                We process them only to provide the service to you, as described
                in our <Link href="/privacy">Privacy Policy</Link>. You can
                export everything at any time via the full-archive export.
            </p>

            <h2>AI providers</h2>
            <p>
                Cloud transcription and summarization run through the AI
                provider you configure. You contract with that provider directly
                and their terms apply to that processing. We are not responsible
                for a third-party provider&apos;s output, availability, or
                pricing.
            </p>

            <h2>Plans and fees</h2>
            <p>
                The hosted service offers a single paid plan (Hosted Pro) at the
                price published on the pricing page. New accounts start with a
                14-day free trial of Hosted Pro with no payment method required.
                At the end of the trial you can add a payment method to
                continue, or let the trial expire.
            </p>
            <p>
                Subscriptions are billed monthly via Stripe and renew
                automatically until you cancel. You can cancel at any time from
                Settings; cancellation takes effect at the end of the current
                billing period and you keep access until then. No partial-month
                refunds are issued for the remaining days of a billing period.
            </p>
            <p>
                Prices are listed exclusive of VAT. If VAT applies to your
                purchase (based on your country of residence), it will be added
                at checkout.
            </p>

            <h2>Right of withdrawal (EU consumers)</h2>
            <p>
                If you are a consumer in the European Union, you have the right
                to withdraw from a distance contract within 14 days of
                concluding it, without giving a reason. Because the service
                begins immediately upon your first payment (digital content
                supplied before the withdrawal period expires), we ask you to
                acknowledge at checkout that you lose the right of withdrawal
                once the service has started. If you do not give that
                acknowledgment, the 14-day withdrawal right applies and you may
                exercise it by emailing{" "}
                <Link href={`mailto:${CONTACT_EMAILS.support}`}>
                    {CONTACT_EMAILS.support}
                </Link>
                .
            </p>

            <h2>Trial expiry, grace period, and account deletion</h2>
            <p>
                If your trial expires without a subscription, or if your
                subscription ends (cancellation, failed payment, or any other
                reason), your account enters a read-only grace period. During
                grace you can still sign in, play back recordings, and export
                your data. Sync from your device and new transcriptions are
                paused.
            </p>
            <p>
                The grace period is 7 days for accounts that never had a paid
                subscription and 30 days for accounts that previously paid. We
                send email reminders during grace. At the end of the grace
                period, your account and all associated data (recordings,
                transcripts, summaries, stored files) are permanently deleted.
                You can also delete your account immediately at any time from
                Settings.
            </p>

            <h2>Availability</h2>
            <p>
                The service is provided as-is and as-available. Sync depends on
                Plaud&apos;s upstream API and AI features depend on the provider
                you configure; both are outside our control. We do our best to
                keep the service running and to communicate outages, but we make
                no uptime guarantee at this stage.
            </p>

            <h2>Disclaimer and liability</h2>
            <p>
                To the fullest extent permitted by law, we disclaim implied
                warranties and are not liable for indirect or consequential
                loss, or for loss of data you could have preserved through the
                export feature. Nothing in these terms limits liability that
                cannot be limited by law, and none of this affects the mandatory
                rights you have as a consumer.
            </p>

            <h2>Reporting illegal or infringing content</h2>
            <p>
                If you believe content on the service is illegal or infringes
                your rights, email{" "}
                <Link href={`mailto:${CONTACT_EMAILS.support}`}>
                    {CONTACT_EMAILS.support}
                </Link>{" "}
                with enough detail to identify the content and the basis for
                your report. We will review and act on valid reports.
            </p>

            <h2>Suspension and termination</h2>
            <p>
                You can stop using the service and delete your account at any
                time. We may suspend or terminate access if you breach these
                terms or put the service or other users at risk. Where a
                suspension applies, you will see a notice explaining it. You can
                export your data before deleting your account.
            </p>

            <h2>Complaints</h2>
            <p>
                If something goes wrong, email{" "}
                <Link href={`mailto:${CONTACT_EMAILS.support}`}>
                    {CONTACT_EMAILS.support}
                </Link>{" "}
                describing the issue and your account email. We will confirm
                receipt and respond within the time required by applicable law,
                normally within 14 days.
            </p>

            <h2>Governing law</h2>
            <p>
                These terms are governed by {GOVERNING_LAW.lawPhrase}. If you
                are a consumer, this does not deprive you of the protection of
                the mandatory provisions of the law of your country of
                residence, and you may bring proceedings in the courts there.
            </p>

            <h2>Changes</h2>
            <p>
                We may update these terms. We will notify registered users of
                material changes by email before they take effect, and update
                the effective date above. If you keep using the service after a
                change takes effect, you accept the updated terms; if you do not
                agree, you can stop using the service and delete your account.
            </p>

            <h2>Contact</h2>
            <p>
                <Link href={`mailto:${CONTACT_EMAILS.support}`}>
                    {CONTACT_EMAILS.support}
                </Link>
            </p>
        </>
    );
}
