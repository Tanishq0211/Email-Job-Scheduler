import Papa from "papaparse";

export interface ParsedRecipients {
  valid: string[];
  invalid: string[];
  duplicatesRemoved: number;
}

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && EMAIL_RE.test(v);
}

/**
 * Extract recipients from raw CSV/TXT content.
 * Handles both `email` and `name,email` header styles, headerless rows,
 * and plain one-address-per-line TXT files. Duplicates are removed
 * case-insensitively; invalid rows are reported, never silently accepted.
 */
export function parseRecipients(raw: string): ParsedRecipients {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicatesRemoved = 0;

  const result = Papa.parse<string[]>(raw.trim(), {
    skipEmptyLines: "greedy",
  });

  for (const row of result.data) {
    if (!row) continue;
    if (isHeaderRow(row)) continue;
    const candidate = pickEmailCell(row);
    if (!candidate) {
      if (row.some((c) => c && c.trim())) invalid.push(row.join(",").trim());
      continue;
    }
    const value = candidate.trim().toLowerCase();
    if (!isValidEmail(value)) {
      invalid.push(candidate.trim());
      continue;
    }
    if (seen.has(value)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(value);
    valid.push(value);
  }

  return { valid, invalid, duplicatesRemoved };
}

function pickEmailCell(row: string[]): string | null {
  // Prefer the last cell that looks like an email (name,email) else first non-empty.
  for (let i = row.length - 1; i >= 0; i--) {
    const cell = row[i]?.trim();
    if (cell && cell.includes("@")) return cell;
  }
  for (const cell of row) {
    const c = cell?.trim();
    if (c) return c;
  }
  return null;
}

const HEADER_RE = /^(e-?mail|mail|email_?address|address)$/i;

function isHeaderRow(row: string[]): boolean {
  return row.some((c) => HEADER_RE.test((c ?? "").trim()));
}

/** Backend-side defense in depth: re-validate a recipient array. */
export function sanitizeRecipients(
  recipients: string[],
): ParsedRecipients {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicatesRemoved = 0;

  for (const r of recipients) {
    const value = r.trim().toLowerCase();
    if (!isValidEmail(value)) {
      invalid.push(r);
      continue;
    }
    if (seen.has(value)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(value);
    valid.push(value);
  }

  return { valid, invalid, duplicatesRemoved };
}
