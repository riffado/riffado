import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/lib/env", () => ({
    env: { IS_HOSTED: true },
}));

vi.mock("@/db", () => ({
    db: { select: vi.fn() },
}));

vi.mock("@/lib/hosted/transcription/mynah", () => ({
    isMynahConfigured: vi.fn(),
}));

import { db } from "@/db";
import { isMynahConfigured } from "@/lib/hosted/transcription/mynah";
import {
    selectTranscriptionProvider,
    type TranscriptionProviderSelection,
    type TranscriptionProviderSelectionInput,
    transcriptionRunsOnMynah,
} from "@/lib/transcription/effective-provider";
import { RIFFADO_INCLUDED_PROVIDER_ID } from "@/lib/transcription/included-provider";

interface Case {
    name: string;
    mynahConfigured: boolean;
    input: TranscriptionProviderSelectionInput;
    expected: TranscriptionProviderSelection;
}

const cases: Case[] = [
    {
        name: "explicit credential id wins over the pointer",
        mynahConfigured: true,
        input: {
            explicitProviderId: "cred-explicit",
            pointer: "cred-pointer",
            hasLegacyDefaultCredential: true,
        },
        expected: { kind: "credential", credentialId: "cred-explicit" },
    },
    {
        name: "explicit credential id wins over a Mynah pointer",
        mynahConfigured: true,
        input: {
            explicitProviderId: "cred-explicit",
            pointer: RIFFADO_INCLUDED_PROVIDER_ID,
            hasLegacyDefaultCredential: false,
        },
        expected: { kind: "credential", credentialId: "cred-explicit" },
    },
    {
        name: "explicit sentinel selects Mynah when configured",
        mynahConfigured: true,
        input: {
            explicitProviderId: RIFFADO_INCLUDED_PROVIDER_ID,
            pointer: "cred-pointer",
            hasLegacyDefaultCredential: true,
        },
        expected: { kind: "managed" },
    },
    {
        name: "explicit sentinel selects nothing when Mynah is not configured",
        mynahConfigured: false,
        input: {
            explicitProviderId: RIFFADO_INCLUDED_PROVIDER_ID,
            pointer: "cred-pointer",
            hasLegacyDefaultCredential: true,
        },
        expected: { kind: "none" },
    },
    {
        name: "pointer sentinel selects Mynah when configured",
        mynahConfigured: true,
        input: {
            pointer: RIFFADO_INCLUDED_PROVIDER_ID,
            hasLegacyDefaultCredential: true,
        },
        expected: { kind: "managed" },
    },
    {
        name: "pointer sentinel selects nothing when Mynah is not configured",
        mynahConfigured: false,
        input: {
            pointer: RIFFADO_INCLUDED_PROVIDER_ID,
            hasLegacyDefaultCredential: false,
        },
        expected: { kind: "none" },
    },
    {
        name: "stale pointer credential id stays a credential and never falls to Mynah",
        mynahConfigured: true,
        input: {
            pointer: "cred-deleted",
            hasLegacyDefaultCredential: false,
        },
        expected: { kind: "credential", credentialId: "cred-deleted" },
    },
    {
        name: "stale explicit credential id stays a credential and never falls to Mynah",
        mynahConfigured: true,
        input: {
            explicitProviderId: "cred-deleted",
            pointer: null,
            hasLegacyDefaultCredential: false,
        },
        expected: { kind: "credential", credentialId: "cred-deleted" },
    },
    {
        name: "pointer selects its credential",
        mynahConfigured: false,
        input: {
            pointer: "cred-pointer",
            hasLegacyDefaultCredential: true,
        },
        expected: { kind: "credential", credentialId: "cred-pointer" },
    },
    {
        name: "empty explicit id falls through to the pointer",
        mynahConfigured: true,
        input: {
            explicitProviderId: "",
            pointer: "cred-pointer",
            hasLegacyDefaultCredential: false,
        },
        expected: { kind: "credential", credentialId: "cred-pointer" },
    },
    {
        name: "legacy default credential applies without a pointer",
        mynahConfigured: true,
        input: {
            pointer: null,
            hasLegacyDefaultCredential: true,
        },
        expected: { kind: "credential", credentialId: null },
    },
    {
        name: "Mynah is the fallback when nothing is set and it is configured",
        mynahConfigured: true,
        input: {
            pointer: null,
            hasLegacyDefaultCredential: false,
        },
        expected: { kind: "managed" },
    },
    {
        name: "nothing configured selects nothing",
        mynahConfigured: false,
        input: {
            pointer: null,
            hasLegacyDefaultCredential: false,
        },
        expected: { kind: "none" },
    },
];

describe("selectTranscriptionProvider", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each(cases)("$name", ({ mynahConfigured, input, expected }) => {
        (isMynahConfigured as Mock).mockReturnValue(mynahConfigured);

        expect(selectTranscriptionProvider(input)).toEqual(expected);
    });
});

describe("transcriptionRunsOnMynah", () => {
    function mockLegacyDefaultLookup(rows: { id: string }[]) {
        (db.select as Mock).mockReturnValue({
            from: () => ({
                where: () => ({
                    limit: () => Promise.resolve(rows),
                }),
            }),
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        (isMynahConfigured as Mock).mockReturnValue(true);
    });

    it("is false without a pointer when a legacy default credential exists", async () => {
        mockLegacyDefaultLookup([{ id: "cred-legacy" }]);

        await expect(transcriptionRunsOnMynah("user-1", null)).resolves.toBe(
            false,
        );
        expect(db.select).toHaveBeenCalledTimes(1);
    });

    it("is true without a pointer and without a legacy default credential", async () => {
        mockLegacyDefaultLookup([]);

        await expect(transcriptionRunsOnMynah("user-1", null)).resolves.toBe(
            true,
        );
        expect(db.select).toHaveBeenCalledTimes(1);
    });

    it("is true for the Mynah sentinel pointer without a database query", async () => {
        await expect(
            transcriptionRunsOnMynah("user-1", RIFFADO_INCLUDED_PROVIDER_ID),
        ).resolves.toBe(true);
        expect(db.select).not.toHaveBeenCalled();
    });

    it("is false for a credential pointer without a database query", async () => {
        await expect(
            transcriptionRunsOnMynah("user-1", "cred-pointer"),
        ).resolves.toBe(false);
        expect(db.select).not.toHaveBeenCalled();
    });

    it("is false when Mynah is not configured, without a database query", async () => {
        (isMynahConfigured as Mock).mockReturnValue(false);

        await expect(transcriptionRunsOnMynah("user-1", null)).resolves.toBe(
            false,
        );
        await expect(
            transcriptionRunsOnMynah("user-1", RIFFADO_INCLUDED_PROVIDER_ID),
        ).resolves.toBe(false);
        expect(db.select).not.toHaveBeenCalled();
    });
});
