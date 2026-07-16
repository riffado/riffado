import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppProgress } from "@/components/app-progress";
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
    metadataBase: new URL(env.APP_URL ?? "https://riffado.com"),
    title: {
        default: "Riffado — Open-source AI transcription for voice recorders",
        template: "%s · Riffado",
    },
    description:
        "Open-source transcription for the voice recorder you already own. Choose your AI, own your transcripts, deploy where you want. Currently supports the Plaud Note family: Note, Note Pro, and NotePin.",
    applicationName: "Riffado",
    manifest: "/manifest.webmanifest",
    openGraph: {
        type: "website",
        siteName: "Riffado",
        title: "Riffado — Open-source AI transcription for voice recorders",
        description:
            "Open-source transcription for the voice recorder you already own. Choose your AI, own your transcripts, deploy where you want.",
        images: [{ url: "/og-home.png", width: 1200, height: 630 }],
    },
    twitter: {
        card: "summary_large_image",
        site: "@riffadohq",
        creator: "@riffadohq",
        title: "Riffado — Open-source AI transcription for voice recorders",
        description:
            "Open-source transcription for the voice recorder you already own. Choose your AI, own your transcripts, deploy where you want.",
        images: ["/og-home.png"],
    },
    appleWebApp: {
        capable: true,
        title: "Riffado",
        statusBarStyle: "black-translucent",
    },
};

export const viewport: Viewport = {
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#ffffff" },
        { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    ],
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body
                className={`${geistSans.variable} ${geistMono.variable} antialiased`}
            >
                <AppProgress>
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
                </AppProgress>
            </body>
        </html>
    );
}
