export default function AuthLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Each auth route renders its own `AuthShell` (wordmark, column and
    // dot-waveform band), so the layout only sets the page ground.
    return <div className="min-h-dvh bg-background">{children}</div>;
}
