import messages from "./zh-CN.json";

export const UI_LOCALE = "zh-CN";

/** Translate application-owned UI text, with English fallback and named parameters. */
export function uiText(
    source: string,
    values: Readonly<Record<string, string | number>> = {},
): string {
    const template = Object.hasOwn(messages, source)
        ? messages[source as keyof typeof messages]
        : source;
    return template.replace(
        /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
        (match, name: string) =>
            Object.hasOwn(values, name) ? String(values[name]) : match,
    );
}
