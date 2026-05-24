import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { RybbitAnalytics } from "@/components/rybbit-analytics";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { env } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    // Resolves relative URLs in `openGraph.images` / `twitter.images`
    // (e.g. `/docs-og/<slug>.png` emitted by per-doc `generateMetadata`)
    // against the deployment origin. Without this, Next falls back to
    // `http://localhost:3000` in production and ships broken social
    // previews. `APP_URL` is allowed to be unset during `next build`
    // (see `src/lib/env.ts`); the fallback keeps the build green and
    // self-host deployments override it at runtime via env.
    metadataBase: new URL(env.APP_URL ?? "https://openplaud.com"),
    title: "OpenPlaud - Professional Audio Workstation",
    description:
        "Professional audio workstation for Plaud devices with AI-powered transcription",
};

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    // Resolved by `src/i18n/request.ts` from the locale cookie or the
    // Accept-Language header. The `lang` attribute on <html> needs to
    // match for assistive tech, search engines, and the browser's
    // built-in translation prompt — without it Chrome offers to
    // "translate from English" on a fully-localized German page.
    const locale = await getLocale();
    const messages = await getMessages();

    return (
        <html lang={locale} suppressHydrationWarning>
            <body
                className={`${geistSans.variable} ${geistMono.variable} antialiased`}
            >
                <NextIntlClientProvider locale={locale} messages={messages}>
                    <ThemeProvider
                        attribute="class"
                        defaultTheme="system"
                        enableSystem
                        disableTransitionOnChange
                    >
                        {/*
                          Tooltip provider wraps the app so any descendant
                          `<Tooltip>` works without a local provider. 200ms
                          delay is the shadcn default-ish: short enough to
                          feel responsive, long enough to avoid firing on
                          incidental mouseovers.
                        */}
                        <TooltipProvider delayDuration={200}>
                            {/*
                              App-wide imperative confirm dialog. Any
                              client component can `useConfirm()` to get
                              a Promise-returning function for destructive
                              flows (delete recording, delete webhook,
                              delete API key, delete custom prompt, etc.).
                              One instance, one dialog node, consistent
                              look + pending-state handling.
                            */}
                            <ConfirmDialogProvider>
                                {children}
                                <Toaster />
                            </ConfirmDialogProvider>
                        </TooltipProvider>
                    </ThemeProvider>
                    <RybbitAnalytics />
                </NextIntlClientProvider>
            </body>
        </html>
    );
}
