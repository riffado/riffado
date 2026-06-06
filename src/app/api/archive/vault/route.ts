import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { requireApiSession } from "@/lib/auth-server";
import { decrypt, encrypt } from "@/lib/encryption";
import { AppError, apiHandler, ErrorCode } from "@/lib/errors";

/**
 * GET /api/archive/vault
 * Returns whether a vault PIN is set (never the PIN itself).
 */
export const GET = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);

    const [row] = await db
        .select({ vaultPin: userSettings.vaultPin })
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    return NextResponse.json({ hasPinLock: !!row?.vaultPin });
});

/**
 * POST /api/archive/vault/verify
 * Verify a supplied PIN against the stored encrypted PIN.
 * Body: { pin: string }
 */
export const POST = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const body = await request.json().catch(() => ({}));
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";

    if (!pin) {
        throw new AppError(ErrorCode.INVALID_INPUT, "pin is required", 400);
    }

    const [row] = await db
        .select({ vaultPin: userSettings.vaultPin })
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    if (!row?.vaultPin) {
        // No PIN set — vault is unlocked.
        return NextResponse.json({ valid: true });
    }

    let storedPin: string;
    try {
        storedPin = decrypt(row.vaultPin);
    } catch {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "PIN could not be verified",
            400,
        );
    }

    return NextResponse.json({ valid: storedPin === pin });
});

/**
 * PATCH /api/archive/vault
 * Set or clear the vault PIN.
 * Body: { pin: string | null, currentPin?: string }
 *   - pin: the new PIN (null to remove the lock)
 *   - currentPin: required when a PIN is already set
 */
export const PATCH = apiHandler(async (request: Request) => {
    const session = await requireApiSession(request);
    const body = await request.json().catch(() => ({}));

    const newPin: string | null =
        body.pin === null
            ? null
            : typeof body.pin === "string"
              ? body.pin.trim()
              : null;
    const currentPin =
        typeof body.currentPin === "string" ? body.currentPin.trim() : null;

    // Validate new PIN format if setting one.
    if (newPin !== null && (newPin.length < 4 || newPin.length > 12)) {
        throw new AppError(
            ErrorCode.INVALID_INPUT,
            "PIN must be 4–12 characters",
            400,
        );
    }

    const [row] = await db
        .select({ vaultPin: userSettings.vaultPin })
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    // If a PIN is already set, the caller must supply the current PIN.
    if (row?.vaultPin) {
        if (!currentPin) {
            throw new AppError(
                ErrorCode.FORBIDDEN,
                "currentPin is required to change or remove an existing PIN",
                403,
            );
        }
        let storedPin: string;
        try {
            storedPin = decrypt(row.vaultPin);
        } catch {
            throw new AppError(
                ErrorCode.INVALID_INPUT,
                "PIN could not be verified",
                400,
            );
        }
        if (storedPin !== currentPin) {
            throw new AppError(
                ErrorCode.FORBIDDEN,
                "Incorrect current PIN",
                403,
            );
        }
    }

    const encryptedPin = newPin ? encrypt(newPin) : null;

    if (row) {
        await db
            .update(userSettings)
            .set({ vaultPin: encryptedPin, updatedAt: new Date() })
            .where(eq(userSettings.userId, session.user.id));
    } else {
        await db
            .insert(userSettings)
            .values({ userId: session.user.id, vaultPin: encryptedPin });
    }

    return NextResponse.json({ success: true, hasPinLock: newPin !== null });
});
