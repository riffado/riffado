import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { validateAiBaseUrl } from "@/lib/ai/validate-base-url";
import { auth } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { env } from "@/lib/env";

// GET - List all AI providers for the user
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

        const providers = await db
            .select({
                id: apiCredentials.id,
                provider: apiCredentials.provider,
                baseUrl: apiCredentials.baseUrl,
                defaultModel: apiCredentials.defaultModel,
                isDefaultTranscription: apiCredentials.isDefaultTranscription,
                isDefaultEnhancement: apiCredentials.isDefaultEnhancement,
                createdAt: apiCredentials.createdAt,
            })
            .from(apiCredentials)
            .where(eq(apiCredentials.userId, session.user.id));

        return NextResponse.json({ providers });
    } catch (error) {
        console.error("Error fetching providers:", error);
        return NextResponse.json(
            { error: "Failed to fetch providers" },
            { status: 500 },
        );
    }
}

// POST - Add new AI provider
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

        const {
            provider,
            apiKey,
            baseUrl,
            defaultModel,
            isDefaultTranscription,
            isDefaultEnhancement,
        } = await request.json();

        if (!provider || !apiKey) {
            return NextResponse.json(
                { error: "Provider and API key are required" },
                { status: 400 },
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

        // Encrypt the API key
        const encryptedKey = encrypt(apiKey);

        // Use a transaction to ensure atomic update of default providers
        const [newProvider] = await db.transaction(async (tx) => {
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

            // Insert new provider
            return await tx
                .insert(apiCredentials)
                .values({
                    userId: session.user.id,
                    provider,
                    apiKey: encryptedKey,
                    baseUrl: baseUrl || null,
                    defaultModel: defaultModel || null,
                    isDefaultTranscription: isDefaultTranscription || false,
                    isDefaultEnhancement: isDefaultEnhancement || false,
                })
                .returning({
                    id: apiCredentials.id,
                    provider: apiCredentials.provider,
                    baseUrl: apiCredentials.baseUrl,
                    defaultModel: apiCredentials.defaultModel,
                    isDefaultTranscription:
                        apiCredentials.isDefaultTranscription,
                    isDefaultEnhancement: apiCredentials.isDefaultEnhancement,
                });
        });

        return NextResponse.json({ provider: newProvider });
    } catch (error) {
        console.error("Error adding provider:", error);
        return NextResponse.json(
            { error: "Failed to add provider" },
            { status: 500 },
        );
    }
}
