import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { personalAccessTokens } from "@/db/schema";
import { auth } from "@/lib/auth";

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
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

        const { id } = await params;
        const now = new Date();
        const [token] = await db
            .update(personalAccessTokens)
            .set({ revokedAt: now, updatedAt: now })
            .where(
                and(
                    eq(personalAccessTokens.id, id),
                    eq(personalAccessTokens.userId, session.user.id),
                ),
            )
            .returning({ id: personalAccessTokens.id });

        if (!token) {
            return NextResponse.json(
                { error: "Token not found" },
                { status: 404 },
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error revoking API token:", error);
        return NextResponse.json(
            { error: "Failed to revoke API token" },
            { status: 500 },
        );
    }
}
