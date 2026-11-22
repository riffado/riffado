import { formatBytes } from "@/lib/format-bytes";

/**
 * Split a byte count into a short number and its unit for a Doto
 * readout: "62.30 GB" becomes { value: "62", unit: "GB" }. Values under
 * 10 keep one decimal ("4.2"); larger ones are whole numbers.
 */
export function splitBytes(bytes: number): { value: string; unit: string } {
    const [raw, unit = "B"] = formatBytes(bytes).split(" ");
    const number = Number.parseFloat(raw);
    if (!Number.isFinite(number)) return { value: raw, unit };
    const value =
        number >= 10 || unit === "B"
            ? Math.round(number).toString()
            : (Math.round(number * 10) / 10).toString();
    return { value, unit };
}

/** `formatBytes` without a trailing ".00" on round values ("50 GB"). */
export function shortBytes(bytes: number): string {
    const { value, unit } = splitBytes(bytes);
    return `${value} ${unit}`;
}
