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

/** Strip characters that break Content-Disposition or a filesystem. */
export function safeFilename(value: string): string {
  return (
    value
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 120) || "export"
  );
}
