import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const dictionary = JSON.parse(fs.readFileSync("src/lib/i18n/zh-CN.json", "utf8"));
const allowlist = JSON.parse(fs.readFileSync("src/lib/i18n/allowlist.json", "utf8"));
const attrs = new Set(["title", "subtitle", "description", "label", "placeholder", "aria-label", "aria-description", "alt", "heading", "ariaLabel"]);
const problems = [];

function files(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const name = path.join(directory, entry.name);
        return entry.isDirectory() ? files(name) : /\.tsx?$/.test(name) ? [name] : [];
    });
}

function parameters(value) {
    return [...new Set([...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]))].sort().join(",");
}

for (const [source, translation] of Object.entries(dictionary)) {
    if (typeof translation !== "string" || !translation.trim() || parameters(source) !== parameters(translation)) {
        problems.push(`Invalid translation or placeholders: ${source}`);
    }
}

for (const file of files("src")) {
    if (file.includes(`${path.sep}tests${path.sep}`)) continue;
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const covered = (text.includes('from "@/lib/i18n') || /^src\/(components\/(auth|dashboard|settings|settings-sections|recordings)\/|app\/\(auth\)\/)/.test(relative)) && !/\/(billing-section|trial-banner|dev-section)\.tsx$/.test(relative) && !relative.startsWith("src/lib/i18n/");
    function report(node, message) {
        problems.push(`${relative}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${message}`);
    }
    function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(sf) === "uiText") {
            const source = node.arguments[0];
            if (source && ts.isStringLiteralLike(source) && !Object.hasOwn(dictionary, source.text)) {
                report(node, `Missing dictionary key: ${source.text}`);
            }
            return;
        }
        if (covered) {
            let source;
            if (ts.isJsxText(node)) source = node.text.replace(/\s+/g, " ").trim();
            if (ts.isStringLiteralLike(node) && ts.isJsxAttribute(node.parent) && attrs.has(node.parent.name.getText(sf))) source = node.text;
            if (ts.isStringLiteralLike(node) && ts.isJsxExpression(node.parent) && !ts.isJsxAttribute(node.parent.parent)) source = node.text;
            if (source && /[A-Za-z]/.test(source) && !allowlist[relative]?.[source]) report(node, `Untranslated UI: ${source}`);
        }
        ts.forEachChild(node, visit);
    }
    visit(sf);
}

if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
} else {
    console.log(`Localization checks passed (${Object.keys(dictionary).length} translations).`);
}
