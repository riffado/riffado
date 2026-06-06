import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { PWARegister } from "@/components/pwa-register";
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

// `theme-color` and `viewport` belong here in Next.js 13+, not in <meta>.
export const viewport: Viewport = {
    themeColor: "#0a0a0a",
    width: "device-width",
    initialScale: 1,
    minimumScale: 1,
    viewportFit: "cover",
};

export const metadata: Metadata = {
    // Resolves relative URLs in `openGraph.images` / `twitter.images`
    // (e.g. `/docs-og/<slug>.png` emitted by per-doc `generateMetadata`)
    // against the deployment origin. Without this, Next falls back to
    // `http://localhost:3000` in production and ships broken social
    // previews. `APP_URL` is allowed to be unset during `next build`
    // (see `src/lib/env.ts`); the fallback keeps the build green and
    // self-host deployments override it at runtime via env.
    metadataBase: new URL(env.APP_URL ?? "https://mesynx.r0073dl053r.com"),
    title: "Mesynx AI - Professional Audio Workstation",
    description:
        "Professional audio workstation for Plaud devices with AI-powered transcription",
    manifest: "/manifest.json",
    appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: "Mesynx AI",
    },
    icons: {
        // Used by iOS Safari for the home screen icon when the manifest
        // isn't parsed (e.g. iOS 15 and older).
        apple: [
            { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
        ],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head />
            <body
                className={`${geistSans.variable} ${geistMono.variable} antialiased`}
            >
                <PWARegister />
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
            </body>
        </html>
    );
}
