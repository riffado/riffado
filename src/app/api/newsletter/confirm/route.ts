import { type NextRequest, NextResponse } from "next/server";
import {
    confirmSubscriber,
    getSubscriberById,
} from "@/db/queries/newsletter-subscriptions";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";

export async function GET(req: NextRequest): Promise<NextResponse> {
    const params = req.nextUrl.searchParams;
    const id = params.get("s");
    const token = params.get("t");

    if (!id || !token) return badRequest("missing parameters");
    if (!verifyUnsubscribeToken("subscriber", id, token)) {
        return badRequest("invalid confirmation link");
    }

    const subscriber = await getSubscriberById(id);
    if (!subscriber) return badRequest("unknown subscription");

    await confirmSubscriber(id);
    return successPage();
}

function badRequest(message: string): NextResponse {
    return new NextResponse(
        renderPage({
            title: "Confirmation link is not valid",
            body: `<p>${escapeHtml(message)}.</p><p>You can subscribe again at <a href="/updates">riffado.com/updates</a>.</p>`,
        }),
        {
            status: 400,
            headers: { "content-type": "text/html; charset=utf-8" },
        },
    );
}

function successPage(): NextResponse {
    return new NextResponse(
        renderPage({
            title: "Subscription confirmed",
            body: `
                <p>Thanks. You'll get an email when we ship something worth telling you about -- typically a few times a year, never more than once a month.</p>
                <p>You can unsubscribe at any time using the link in the footer of every email.</p>
            `,
        }),
        {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
        },
    );
}

function renderPage({ title, body }: { title: string; body: string }): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} -- Riffado</title>
  <meta name="robots" content="noindex" />
  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 36rem; margin: 6rem auto; padding: 0 1.5rem; line-height: 1.55; color: #111; background: #fafafa; }
    @media (prefers-color-scheme: dark) { body { color: #e7e7e7; background: #0a0a0a; } a { color: #8ab4ff; } }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    p { margin: 0 0 1rem; }
    a { color: inherit; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
