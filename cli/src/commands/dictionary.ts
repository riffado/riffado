import { spawnSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { Command } from "commander";
import {
    getDictionaryPath,
    ensureDictionaryFile,
    loadDictionary,
} from "../dictionary";

export const dictionaryCommand = new Command("dictionary")
    .description(
        "Manage the dictionary for improved transcription accuracy (terms and corrections)",
    )
    .action(() => {
        // Default action: show the dictionary
        showDictionary();
    });

dictionaryCommand
    .command("show")
    .description("Show all terms and corrections in the dictionary")
    .action(() => {
        showDictionary();
    });

dictionaryCommand
    .command("edit")
    .description("Open the dictionary file in your editor ($EDITOR)")
    .action(() => {
        const path = ensureDictionaryFile();
        const editor = process.env.EDITOR || process.env.VISUAL || "vi";
        console.log(`Opening ${path} in ${editor}...`);
        // Use shell: true so $EDITOR values with arguments (e.g. "code --wait") work
        const result = spawnSync(`${editor} "${path}"`, {
            stdio: "inherit",
            shell: true,
        });
        if (result.error || result.status !== 0) {
            console.error(
                `Failed to open editor. Edit the file directly: ${path}`,
            );
            process.exit(1);
        }
    });

dictionaryCommand
    .command("path")
    .description("Print the dictionary file path")
    .action(() => {
        console.log(getDictionaryPath());
    });

dictionaryCommand
    .command("add")
    .description(
        'Add a term or correction (e.g., "TiVA" or "Diva → TiVA")',
    )
    .argument("<entry...>", "Term or correction to add")
    .action((entryParts: string[]) => {
        const entry = entryParts.join(" ");
        const path = ensureDictionaryFile();

        // Check if it already exists
        const content = readFileSync(path, "utf-8");
        if (content.split("\n").some((line) => line.trim() === entry)) {
            console.log(`Already in dictionary: ${entry}`);
            return;
        }

        appendFileSync(path, `${entry}\n`, "utf-8");
        console.log(`Added: ${entry}`);
    });

function showDictionary(): void {
    const dict = loadDictionary();

    if (dict.terms.length === 0 && dict.corrections.length === 0) {
        console.log("Dictionary is empty.");
        console.log(
            "\nAdd terms to improve transcription accuracy:",
        );
        console.log("  openplaud dictionary add TiVA");
        console.log('  openplaud dictionary add "Plot → Plaud"');
        console.log("  openplaud dictionary edit");
        return;
    }

    const plainTerms = dict.terms.filter(
        (t) => !dict.corrections.some((c) => c.to === t),
    );

    if (plainTerms.length > 0) {
        console.log(`Terms (${plainTerms.length}):`);
        for (const term of plainTerms) {
            console.log(`  ${term}`);
        }
    }

    if (dict.corrections.length > 0) {
        if (plainTerms.length > 0) console.log("");
        console.log(`Corrections (${dict.corrections.length}):`);
        for (const { from, to } of dict.corrections) {
            console.log(`  ${from} → ${to}`);
        }
    }

    console.log(`\nFile: ${getDictionaryPath()}`);
}
