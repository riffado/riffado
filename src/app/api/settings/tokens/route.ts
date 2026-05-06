import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { personalAccessTokens } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
    createPersonalAccessToken,
    getPersonalAccessTokenPrefix,
    hashPersonalAccessToken,
    normalizeTokenScopes,
} from "@/lib/auth-request";

function serializeToken(token: typeof personalAccessTokens.$inferSelect) {
    return {
        id: token.id,
        name: token.name,
        tokenPrefix: token.tokenPrefix,
        scopes: token.scopes,
        lastUsedAt: token.lastUsedAt,
        expiresAt: token.expiresAt,
        revokedAt: token.revokedAt,
        createdAt: token.createdAt,
    };
}

function parseExpiresAt(value: unknown): Date | null {
    if (value == null || value === "") return null;
    if (typeof value !== "string")
        throw new Error("expiresAt must be a string");

    const expiresAt = new Date(value);
    if (Number.isNaN(expiresAt.getTime())) {
        throw new Error("expiresAt must be an ISO timestamp");
    }
    return expiresAt;
}

export async function GET(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const tokens = await db
            .select()
            .from(personalAccessTokens)
            .where(eq(personalAccessTokens.userId, session.user.id))
            .orderBy(desc(personalAccessTokens.createdAt));

        return NextResponse.json({ tokens: tokens.map(serializeToken) });
    } catch (error) {
        console.error("Error fetching API tokens:", error);
        return NextResponse.json(
            { error: "Failed to fetch API tokens" },
            { status: 500 },
        );
    }
}

export async function POST(request: Request) {
    try {
        const session = await auth.api.getSession({
            headers: request.headers,
        });

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
        >;
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) {
            return NextResponse.json(
                { error: "Token name is required" },
                { status: 400 },
            );
        }
        if (name.length > 120) {
            return NextResponse.json(
                { error: "Token name must be 120 characters or less" },
                { status: 400 },
            );
        }

        let expiresAt: Date | null;
        try {
            expiresAt = parseExpiresAt(body.expiresAt);
        } catch (error) {
            return NextResponse.json(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : "Invalid expiresAt",
                },
                { status: 400 },
            );
        }

        if (expiresAt && expiresAt <= new Date()) {
            return NextResponse.json(
                { error: "expiresAt must be in the future" },
                { status: 400 },
            );
        }

        const scopes = normalizeTokenScopes(body.scopes);
        const rawToken = createPersonalAccessToken();

        const [token] = await db
            .insert(personalAccessTokens)
            .values({
                userId: session.user.id,
                name,
                tokenHash: hashPersonalAccessToken(rawToken),
                tokenPrefix: getPersonalAccessTokenPrefix(rawToken),
                scopes,
                expiresAt,
            })
            .returning();

        return NextResponse.json(
            {
                token: rawToken,
                accessToken: serializeToken(token),
            },
            { status: 201 },
        );
    } catch (error) {
        console.error("Error creating API token:", error);
        return NextResponse.json(
            { error: "Failed to create API token" },
            { status: 500 },
        );
    }
}
