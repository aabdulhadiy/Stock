import "server-only";
import ExcelJS from "exceljs";
import { parseMoneyToCents } from "@/lib/money";
import type { TranslationKey } from "@/i18n";

/**
 * One-time Excel import of the product list and opening stock (§14).
 *
 * The flow is parse → validate → preview → confirm. Nothing touches the
 * database until the Director has seen exactly which rows are good and which
 * are not, and every rejected row says why, on which line.
 */

export interface ImportColumnSpec {
  key: keyof ImportRowInput;
  /** Header written into the template; also matched case-insensitively. */
  header: string;
  required: boolean;
  example: string | number;
}

export interface ImportRowInput {
  sku: string;
  name: string;
  category: string;
  unitsPerBox: string;
  unitsPerBag: string;
  boxVolumeM3: string;
  bagVolumeM3: string;
  weightKg: string;
  weightBasis: string;
  dimLengthCm: string;
  dimWidthCm: string;
  dimHeightCm: string;
  dimsBasis: string;
  costPrice: string;
  marketPrice: string;
  exportPrice: string;
  minStock: string;
  openingStock: string;
}

/**
 * Template layout. `header` strings are intentionally English: the template is
 * a machine-readable interchange file, and matching a localised header would
 * break the moment someone re-saved it in another language.
 */
export const IMPORT_COLUMNS: ImportColumnSpec[] = [
  { key: "sku", header: "SKU", required: true, example: "TOY-001" },
  { key: "name", header: "Name", required: true, example: "Teddy bear 30cm" },
  { key: "category", header: "Category", required: false, example: "Soft toys" },
  { key: "unitsPerBox", header: "Units per box", required: true, example: 12 },
  { key: "unitsPerBag", header: "Units per bag", required: false, example: 50 },
  { key: "boxVolumeM3", header: "Box volume m3", required: true, example: 0.045 },
  { key: "bagVolumeM3", header: "Bag volume m3", required: false, example: 0.09 },
  { key: "weightKg", header: "Weight kg", required: true, example: 6.5 },
  { key: "weightBasis", header: "Weight basis (UNIT/BOX)", required: true, example: "BOX" },
  { key: "dimLengthCm", header: "Length cm", required: true, example: 40 },
  { key: "dimWidthCm", header: "Width cm", required: true, example: 30 },
  { key: "dimHeightCm", header: "Height cm", required: true, example: 25 },
  { key: "dimsBasis", header: "Dimensions basis (UNIT/BOX)", required: true, example: "BOX" },
  { key: "costPrice", header: "Cost price USD", required: true, example: 4.5 },
  { key: "marketPrice", header: "Market price USD", required: true, example: 7.9 },
  { key: "exportPrice", header: "Export price USD", required: true, example: 9.5 },
  { key: "minStock", header: "Minimum stock", required: false, example: 100 },
  { key: "openingStock", header: "Opening stock (units)", required: false, example: 500 },
];

/** The validated shape a good row produces. */
export interface ImportRow {
  rowNumber: number;
  sku: string;
  name: string;
  categoryName: string | null;
  unitsPerBox: number;
  unitsPerBag: number | null;
  boxVolumeM3: string;
  bagVolumeM3: string | null;
  weightKg: string;
  weightBasis: "UNIT" | "BOX";
  dimLengthCm: string;
  dimWidthCm: string;
  dimHeightCm: string;
  dimsBasis: "UNIT" | "BOX";
  costPriceCents: number;
  marketPriceCents: number;
  exportPriceCents: number;
  minStock: number | null;
  openingStock: number;
}

export interface ImportProblem {
  rowNumber: number;
  sku: string;
  /** Translation key, plus optional parameters. */
  messageKey: TranslationKey;
  params?: Record<string, string | number>;
  /** The column that failed, for the preview table. */
  column?: string;
}

export interface ImportParseResult {
  rows: ImportRow[];
  problems: ImportProblem[];
  /** True when the workbook could not be read at all. */
  unreadable?: boolean;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export async function importTemplateBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Warehouse & Sales";
  const ws = wb.addWorksheet("Products");

  const header = ws.addRow(IMPORT_COLUMNS.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell, i) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      // Required columns get a stronger tint so they are obvious at a glance.
      fgColor: { argb: IMPORT_COLUMNS[i - 1].required ? "FFDBEAFE" : "FFF1F5F9" },
    };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const example = ws.addRow(IMPORT_COLUMNS.map((c) => c.example));
  example.font = { italic: true, color: { argb: "FF64748B" } };

  IMPORT_COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(14, c.header.length + 3);
  });

  // A short instruction sheet, so the file explains itself without the manual.
  const notes = wb.addWorksheet("Notes");
  notes.getColumn(1).width = 110;
  for (const line of [
    "How to use this template",
    "",
    "1. Replace the italic example row with your own products. Delete the example row.",
    "2. Blue columns are required. Grey columns may be left blank.",
    "3. SKU must be unique. An existing SKU updates that product instead of creating a new one.",
    "4. Prices are in USD, e.g. 7.90. Use a dot or a comma for the decimal separator.",
    "5. 'Weight basis' and 'Dimensions basis' accept UNIT or BOX.",
    "6. 'Opening stock' is optional and is recorded as a goods receipt dated today.",
    "7. Rows with problems are listed before import and are skipped; nothing is saved until you confirm.",
  ]) {
    notes.addRow([line]);
  }
  notes.getRow(1).font = { bold: true, size: 13 };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    // Formula / rich-text / hyperlink cells.
    const obj = value as unknown as Record<string, unknown>;
    if ("result" in obj) return cellText(obj.result as ExcelJS.CellValue);
    if ("text" in obj) return String(obj.text).trim();
    if ("richText" in obj) {
      return (obj.richText as { text: string }[]).map((r) => r.text).join("").trim();
    }
  }
  return String(value).trim();
}

function toInt(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "");
  if (cleaned === "") return null;
  // Excel often hands back "12" as "12.0".
  const n = Number(cleaned.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? n : Math.round(n) === n ? Math.round(n) : null;
}

function toDecimalString(raw: string, scale: number): string | null {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(scale);
}

function toBasis(raw: string): "UNIT" | "BOX" | null {
  const v = raw.trim().toUpperCase();
  if (v === "UNIT" || v === "UNITS" || v === "PCS" || v === "PIECE") return "UNIT";
  if (v === "BOX" || v === "BOXES" || v === "KAROBKA") return "BOX";
  return null;
}

export async function parseImportWorkbook(
  buffer: Buffer,
): Promise<ImportParseResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { rows: [], problems: [], unreadable: true };
  }

  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], problems: [], unreadable: true };

  // Map headers to column indices so column order does not have to match.
  const headerRow = ws.getRow(1);
  const indexByKey = new Map<keyof ImportRowInput, number>();
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const specByHeader = new Map(
    IMPORT_COLUMNS.map((c) => [normalise(c.header), c.key] as const),
  );
  headerRow.eachCell((cell, col) => {
    const key = specByHeader.get(normalise(cellText(cell.value)));
    if (key) indexByKey.set(key, col);
  });

  // Fall back to the canonical order when the header row is missing/renamed.
  if (indexByKey.size === 0) {
    IMPORT_COLUMNS.forEach((c, i) => indexByKey.set(c.key, i + 1));
  }

  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  const seenSkus = new Map<string, number>();

  const lastRow = ws.rowCount;
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const get = (key: keyof ImportRowInput): string => {
      const col = indexByKey.get(key);
      return col ? cellText(row.getCell(col).value) : "";
    };

    const sku = get("sku");
    const name = get("name");

    // Genuinely blank rows are skipped silently — trailing empties are normal.
    const isBlank = IMPORT_COLUMNS.every((c) => get(c.key) === "");
    if (isBlank) continue;

    const fail = (
      messageKey: TranslationKey,
      column?: string,
      params?: Record<string, string | number>,
    ) => {
      problems.push({ rowNumber: r, sku: sku || `#${r}`, messageKey, column, params });
    };

    if (!sku) {
      fail("valid.required", "SKU");
      continue;
    }
    if (!name) {
      fail("valid.required", "Name");
      continue;
    }

    const skuKey = sku.toLowerCase();
    if (seenSkus.has(skuKey)) {
      fail("import.duplicateSku", "SKU", { sku });
      continue;
    }

    const unitsPerBox = toInt(get("unitsPerBox"));
    if (unitsPerBox === null || unitsPerBox < 1) {
      fail("valid.positive", "Units per box");
      continue;
    }

    const unitsPerBagRaw = get("unitsPerBag");
    const unitsPerBag = unitsPerBagRaw === "" ? null : toInt(unitsPerBagRaw);
    if (unitsPerBagRaw !== "" && (unitsPerBag === null || unitsPerBag < 1)) {
      fail("valid.positive", "Units per bag");
      continue;
    }

    const boxVolumeM3 = toDecimalString(get("boxVolumeM3"), 6);
    if (boxVolumeM3 === null) {
      fail("valid.positive", "Box volume m3");
      continue;
    }
    const bagVolumeRaw = get("bagVolumeM3");
    const bagVolumeM3 = bagVolumeRaw === "" ? null : toDecimalString(bagVolumeRaw, 6);
    if (bagVolumeRaw !== "" && bagVolumeM3 === null) {
      fail("valid.positive", "Bag volume m3");
      continue;
    }

    const weightKg = toDecimalString(get("weightKg"), 3);
    if (weightKg === null) {
      fail("valid.positive", "Weight kg");
      continue;
    }
    const weightBasis = toBasis(get("weightBasis")) ?? "BOX";
    const dimsBasis = toBasis(get("dimsBasis")) ?? "BOX";

    const dimLengthCm = toDecimalString(get("dimLengthCm"), 1);
    const dimWidthCm = toDecimalString(get("dimWidthCm"), 1);
    const dimHeightCm = toDecimalString(get("dimHeightCm"), 1);
    if (!dimLengthCm || !dimWidthCm || !dimHeightCm) {
      fail("valid.positive", "Length / Width / Height cm");
      continue;
    }

    const costPriceCents = parseMoneyToCents(get("costPrice"));
    const marketPriceCents = parseMoneyToCents(get("marketPrice"));
    const exportPriceCents = parseMoneyToCents(get("exportPrice"));
    if (costPriceCents === null || costPriceCents < 0) {
      fail("valid.money", "Cost price USD");
      continue;
    }
    if (marketPriceCents === null || marketPriceCents < 0) {
      fail("valid.money", "Market price USD");
      continue;
    }
    if (exportPriceCents === null || exportPriceCents < 0) {
      fail("valid.money", "Export price USD");
      continue;
    }

    const minStockRaw = get("minStock");
    const minStock = minStockRaw === "" ? null : toInt(minStockRaw);
    if (minStockRaw !== "" && (minStock === null || minStock < 0)) {
      fail("valid.nonNegative", "Minimum stock");
      continue;
    }

    const openingRaw = get("openingStock");
    const opening = openingRaw === "" ? 0 : toInt(openingRaw);
    if (openingRaw !== "" && (opening === null || opening < 0)) {
      fail("valid.nonNegative", "Opening stock (units)");
      continue;
    }

    seenSkus.set(skuKey, r);
    rows.push({
      rowNumber: r,
      sku,
      name,
      categoryName: get("category") || null,
      unitsPerBox,
      unitsPerBag,
      boxVolumeM3,
      bagVolumeM3,
      weightKg,
      weightBasis,
      dimLengthCm,
      dimWidthCm,
      dimHeightCm,
      dimsBasis,
      costPriceCents,
      marketPriceCents,
      exportPriceCents,
      minStock,
      openingStock: opening ?? 0,
    });
  }

  return { rows, problems };
}
