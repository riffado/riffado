import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { validateAiBaseUrl } from "@/lib/ai/validate-base-url";
import { auth } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { env } from "@/lib/env";

// PUT - Update AI provider
export async function PUT(
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
        const {
            apiKey,
            baseUrl,
            defaultModel,
            isDefaultTranscription,
            isDefaultEnhancement,
        } = await request.json();

        // Verify ownership
        const [existing] = await db
            .select()
            .from(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.id, id),
                    eq(apiCredentials.userId, session.user.id),
                ),
            )
            .limit(1);

        if (!existing) {
            return NextResponse.json(
                { error: "Provider not found" },
                { status: 404 },
            );
        }

        // On hosted, the app process can't reach the user's machine — reject
        // localhost / loopback baseUrls (e.g. LM Studio, Ollama) with a clear
        // message. Self-host accepts everything.
        const baseUrlCheck = validateAiBaseUrl(baseUrl, {
            isHosted: env.IS_HOSTED,
        });
        if (!baseUrlCheck.ok) {
            return NextResponse.json(
                { error: baseUrlCheck.message },
                { status: 400 },
            );
        }

        // Use a transaction to ensure atomic update of default providers
        await db.transaction(async (tx) => {
            // If setting as default, remove default flag from other providers
            if (isDefaultTranscription) {
                await tx
                    .update(apiCredentials)
                    .set({ isDefaultTranscription: false })
                    .where(
                        and(
                            eq(apiCredentials.userId, session.user.id),
                            eq(apiCredentials.isDefaultTranscription, true),
                        ),
                    );
            }

            if (isDefaultEnhancement) {
                await tx
                    .update(apiCredentials)
                    .set({ isDefaultEnhancement: false })
                    .where(
                        and(
                            eq(apiCredentials.userId, session.user.id),
                            eq(apiCredentials.isDefaultEnhancement, true),
                        ),
                    );
            }

            // Build update object
            const updateData: {
                baseUrl: string | null;
                defaultModel: string | null;
                isDefaultTranscription: boolean;
                isDefaultEnhancement: boolean;
                updatedAt: Date;
                apiKey?: string;
            } = {
                baseUrl: baseUrl || null,
                defaultModel: defaultModel || null,
                isDefaultTranscription: isDefaultTranscription || false,
                isDefaultEnhancement: isDefaultEnhancement || false,
                updatedAt: new Date(),
            };

            // Only update API key if provided
            if (apiKey) {
                updateData.apiKey = encrypt(apiKey);
            }

            // Update provider
            await tx
                .update(apiCredentials)
                .set(updateData)
                .where(eq(apiCredentials.id, id));
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error updating provider:", error);
        return NextResponse.json(
            { error: "Failed to update provider" },
            { status: 500 },
        );
    }
}

// DELETE - Remove AI provider
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

        // Verify ownership and delete
        await db
            .delete(apiCredentials)
            .where(
                and(
                    eq(apiCredentials.id, id),
                    eq(apiCredentials.userId, session.user.id),
                ),
            );

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting provider:", error);
        return NextResponse.json(
            { error: "Failed to delete provider" },
            { status: 500 },
        );
    }
}
