import { eq } from "drizzle-orm";
import { ArchiveVaultClient } from "@/components/archive/archive-vault-client";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { requireAuth } from "@/lib/auth-server";
import { decryptText } from "@/lib/encryption/fields";

export const metadata = { title: "Archive Vault – Mesynx AI" };

export default async function ArchivePage() {
    const session = await requireAuth();

    // Check if the vault has a PIN set server-side (read from userSettings).
    const [settings] = await db
        .select({ vaultPin: userSettings.vaultPin })
        .from(userSettings)
        .where(eq(userSettings.userId, session.user.id))
        .limit(1);

    let hasPinLock = false;
    if (settings?.vaultPin) {
        try {
            // If the decryption works the pin is set; we don't need the value.
            decryptText(settings.vaultPin);
            hasPinLock = true;
        } catch {
            hasPinLock = false;
        }
    }

    return <ArchiveVaultClient hasPinLock={hasPinLock} />;
}
