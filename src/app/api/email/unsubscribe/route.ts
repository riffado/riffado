import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
    getSubscriberById,
    unsubscribeSubscriber,
} from "@/db/queries/newsletter-subscriptions";
import { users } from "@/db/schema";
import {
    type UnsubscribeAudience,
    verifyUnsubscribeToken,
} from "@/lib/email/unsubscribe-token";

export async function GET(req: NextRequest): Promise<NextResponse> {
    return handleGet(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    return handlePost(req);
}

interface ParsedParams {
    audience: UnsubscribeAudience;
    id: string;
    token: string;
}

function parseAndVerify(req: NextRequest): ParsedParams | string {
    const params = req.nextUrl.searchParams;
    const token = params.get("t");
    if (!token) return "missing token";

    const userId = params.get("u");
    const subscriberId = params.get("s");
    if (userId && subscriberId) return "ambiguous recipient";
    if (!userId && !subscriberId) return "missing recipient";

    const audience: UnsubscribeAudience = userId ? "user" : "subscriber";
    const id = userId ?? subscriberId;
    if (!id) return "missing recipient";

    if (!verifyUnsubscribeToken(audience, id, token)) {
        return "invalid token";
    }
    return { audience, id, token };
}

async function handleGet(req: NextRequest): Promise<NextResponse> {
    const result = parseAndVerify(req);
    if (typeof result === "string") return badRequest(result);
    return confirmPage(result);
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
    const result = parseAndVerify(req);
    if (typeof result === "string") return badRequest(result);

    const { audience, id } = result;
    if (audience === "user") {
        await db
            .update(users)
            .set({
                marketingEmailConsent: false,
                updatedAt: new Date(),
            })
            .where(eq(users.id, id));
    } else {
        const existing = await getSubscriberById(id);
        if (!existing) return badRequest("unknown subscriber");
        await unsubscribeSubscriber(id);
    }

    return successPage();
}

function confirmPage(params: ParsedParams): NextResponse {
    const idParam = params.audience === "user" ? "u" : "s";
    const action = `/api/email/unsubscribe?${idParam}=${encodeURIComponent(params.id)}&t=${encodeURIComponent(params.token)}`;
    return new NextResponse(
        renderPage({
            title: "Unsubscribe from product updates?",
            body: `
                <p>Click the button below to stop receiving Riffado product updates at this address.</p>
                <p>You'll still receive transactional email -- password resets, sync notifications you've opted into, and security advisories. Those are sent regardless of marketing preferences.</p>
                <form method="POST" action="${escapeAttr(action)}" style="margin-top:1.5rem;">
                  <button type="submit" style="appearance:none;border:0;border-radius:6px;padding:0.7rem 1.2rem;background:#111;color:#fff;font:inherit;cursor:pointer;">Unsubscribe</button>
                </form>
            `,
        }),
        {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
        },
    );
}

function badRequest(message: string): NextResponse {
    return new NextResponse(
        renderPage({
            title: "Unsubscribe link is not valid",
            body: `<p>${escapeHtml(message)}.</p><p>If you keep getting marketing emails, reply to one and we'll remove you manually.</p>`,
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
            title: "You have been unsubscribed",
            body: `
                <p>You will no longer receive product updates from Riffado at this address.</p>
                <p>You'll still receive transactional email -- password resets, sync notifications you've opted into, and security advisories.</p>
                <p>Changed your mind? Marketing preferences live in your <a href="/settings">account settings</a>.</p>
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
    @media (prefers-color-scheme: dark) { body { color: #e7e7e7; background: #0a0a0a; button { background: #fff !important; color: #111 !important; } } a { color: #8ab4ff; } }
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

function escapeAttr(s: string): string {
    return escapeHtml(s);
}
