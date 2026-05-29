export default function AuthLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Background ownership moved to each auth route so design variants
    // (see login/page.tsx) can paint full-bleed without competing with
    // a shared gradient.
    return <div className="min-h-screen bg-background">{children}</div>;
}
