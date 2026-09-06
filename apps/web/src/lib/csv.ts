import Papa from "papaparse";

export interface CsvParseResult {
  fileName: string;
  valid: string[];
  invalid: string[];
  duplicatesRemoved: number;
}

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmailValue(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && EMAIL_RE.test(v);
}

/**
 * Client-side CSV/TXT parsing (the backend re-validates everything).
 * Supports `email` headers, `name,email` headers, headerless CSV and
 * plain one-per-line TXT files.
 */
export function parseRecipientsFile(file: File): Promise<CsvParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const seen = new Set<string>();
      const valid: string[] = [];
      const invalid: string[] = [];
      let duplicatesRemoved = 0;

      const parsed = Papa.parse<string[]>(text.trim(), {
        skipEmptyLines: "greedy",
      });

      for (const row of parsed.data) {
        if (!row) continue;
        if (row.some((c) => /^(e-?mail|mail|email_?address|address)$/i.test((c ?? "").trim()))) {
          continue; // header row
        }
        const candidate =
          [...row].reverse().find((c) => c && c.trim().includes("@")) ??
          row.find((c) => c && c.trim());
        if (!candidate) continue;
        const value = candidate.trim().toLowerCase();
        if (!isValidEmailValue(value)) {
          invalid.push(value);
          continue;
        }
        if (seen.has(value)) {
          duplicatesRemoved++;
          continue;
        }
        seen.add(value);
        valid.push(value);
      }

      resolve({ fileName: file.name, valid, invalid, duplicatesRemoved });
    };
    reader.readAsText(file);
  });
}
