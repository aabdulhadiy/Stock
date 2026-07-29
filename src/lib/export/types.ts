/**
 * One document description that both the Excel and the PDF writer consume, so
 * a report is defined once and exported in either format identically (§10.3).
 *
 * All strings here are ALREADY TRANSLATED by the caller — §13 requires export
 * headers and titles to follow the user's language, and the writers must never
 * invent English text of their own.
 */

export interface ExportColumn {
  /** Translated header text. */
  header: string;
  key: string;
  /** Right-align and treat as a number. */
  numeric?: boolean;
  /** Relative width for the PDF; character width for Excel. */
  weight?: number;
  width?: number;
}

export type ExportCell = string | number | null;

export interface ExportTable {
  /** Excel worksheet name and PDF section heading. */
  title: string;
  columns: ExportColumn[];
  rows: Record<string, ExportCell>[];
  /** Optional totals row, rendered bold/underlined. */
  totals?: Record<string, ExportCell>;
}

export interface ExportDoc {
  /** Filename without extension; must be filesystem-safe. */
  filenameBase: string;
  /** Translated document title. */
  title: string;
  /** e.g. the period, or "order no. — customer — date" for a picking list. */
  subtitle?: string;
  /**
   * A prominent note, e.g. §7.5's "this warehouse copy contains no prices".
   */
  note?: string;
  tables: ExportTable[];
}

export type ExportFormat = "xlsx" | "pdf";

export function parseFormat(value: string | null | undefined): ExportFormat {
  return value === "pdf" ? "pdf" : "xlsx";
}

/**
 * Strip characters that would break a filename, keeping letters in any script
 * so a Russian or Uzbek title stays readable.
 *
 * Apostrophes and quotes are dropped rather than replaced, so "qoldig'i"
 * becomes "qoldigi" and not "qoldig-i". Leading dots are removed so an export
 * can never produce a dotfile or a path fragment.
 */
export function safeFilename(value: string): string {
  return (
    value
      .replace(/['"’`]/g, "")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/\.{2,}/g, ".")
      .replace(/^[-.]+/, "")
      .replace(/[-.]+$/, "")
      .slice(0, 120) || "export"
  );
}

/**
 * Build a `Content-Disposition` value for a filename that may contain non-ASCII
 * characters — which ours routinely do, because titles are translated and
 * Russian/Uzbek titles carry Cyrillic and diacritics.
 *
 * HTTP header values are ByteStrings (0-255), so a raw Cyrillic filename throws.
 * RFC 6266 solves this with two parameters: an ASCII `filename` that every
 * client understands, plus a percent-encoded UTF-8 `filename*` that modern
 * browsers prefer.
 */
export function contentDisposition(filename: string, extension: string): string {
  const full = `${filename}.${extension}`;

  // ASCII fallback: drop anything outside printable ASCII. A wholly non-Latin
  // title leaves nothing behind, so fall back to a generic name — the check is
  // on the base name, otherwise a Cyrillic-only title would download as "pdf".
  const asciiBase = filename
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "")
    .trim();
  const ascii = `${asciiBase || "export"}.${extension}`;

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(full)}`;
}
