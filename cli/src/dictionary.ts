import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getConfigDir } from "./config";

const DICTIONARY_FILE = `${getConfigDir()}/dictionary.txt`;

export interface Dictionary {
    /** Terms to include in the Whisper prompt (biases recognition) */
    terms: string[];
    /** Correction rules: wrong → correct (applied as post-processing) */
    corrections: Array<{ from: string; to: string }>;
}

/**
 * Parse the dictionary file.
 *
 * Format:
 * - Lines starting with # are comments
 * - Empty lines are ignored
 * - Lines with " → " are corrections: wrong → correct
 * - Everything else is a plain term
 *
 * Example:
 *   # People
 *   Sophie
 *   Ivo
 *
 *   # Corrections
 *   Plot → Plaud
 *   Diva → TiVA
 */
export function loadDictionary(): Dictionary {
    if (!existsSync(DICTIONARY_FILE)) {
        return { terms: [], corrections: [] };
    }

    const content = readFileSync(DICTIONARY_FILE, "utf-8");
    return parseDictionary(content);
}

export function parseDictionary(content: string): Dictionary {
    const terms: string[] = [];
    const corrections: Array<{ from: string; to: string }> = [];

    for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();

        // Skip empty lines and comments
        if (!line || line.startsWith("#")) continue;

        // Correction rule: "wrong → correct"
        const arrowIndex = line.indexOf(" → ");
        if (arrowIndex !== -1) {
            const from = line.slice(0, arrowIndex).trim();
            const to = line.slice(arrowIndex + 3).trim();
            if (from && to) {
                corrections.push({ from, to });
                // Also add the correct form as a term for the Whisper prompt
                if (!terms.includes(to)) {
                    terms.push(to);
                }
            }
            continue;
        }

        // Plain term
        if (!terms.includes(line)) {
            terms.push(line);
        }
    }

    return { terms, corrections };
}

/**
 * Build a Whisper prompt string from the dictionary.
 * Contains all correct terms, which biases Whisper toward recognizing them.
 */
export function buildWhisperPrompt(dict: Dictionary): string | undefined {
    if (dict.terms.length === 0) return undefined;
    return dict.terms.join(", ");
}

/**
 * Apply correction rules to a transcription.
 * Replaces all occurrences of each "from" pattern with "to".
 * Uses word-boundary-aware matching to avoid partial replacements.
 */
export function applyCorrections(
    text: string,
    corrections: Array<{ from: string; to: string }>,
): string {
    let result = text;
    for (const { from, to } of corrections) {
        // Escape regex special characters in the "from" string
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Use a global, case-insensitive regex with word-ish boundaries.
        // \b doesn't work well with hyphens and special chars, so we use
        // a lookaround that checks for word boundaries or start/end of string.
        const regex = new RegExp(
            `(?<=^|[\\s,.:;!?"""''()\\[\\]{}])${escaped}(?=$|[\\s,.:;!?"""''()\\[\\]{}])`,
            "gi",
        );
        result = result.replace(regex, to);
    }
    return result;
}

/**
 * Get the dictionary file path.
 */
export function getDictionaryPath(): string {
    return DICTIONARY_FILE;
}

/**
 * Ensure the dictionary file exists (creates an empty one with a header comment).
 */
export function ensureDictionaryFile(): string {
    if (!existsSync(DICTIONARY_FILE)) {
        const dir = dirname(DICTIONARY_FILE);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        writeFileSync(
            DICTIONARY_FILE,
            [
                "# OpenPlaud Dictionary",
                "# ",
                "# Terms listed here improve Whisper transcription accuracy.",
                "# They are passed as context to the Whisper model and also",
                "# used for post-processing corrections.",
                "#",
                "# Format:",
                "#   term           — biases Whisper toward recognizing this word",
                "#   wrong → right  — also replaces 'wrong' with 'right' in output",
                "#",
                "# Examples:",
                "#   TiVA",
                "#   Preclinics",
                "#   Plot → Plaud",
                "#   Diva → TiVA",
                "",
            ].join("\n"),
            { encoding: "utf-8", mode: 0o644 },
        );
    }
    return DICTIONARY_FILE;
}
