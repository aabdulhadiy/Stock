import ExcelJS from "exceljs";

/**
 * Bulk product import parsing & validation (spec 4.6). Shared by the preview
 * and commit steps so the rules are identical in both.
 */

export const IMPORT_COLUMNS = [
  "name",
  "sku",
  "type",
  "suggested_price",
  "cost_price",
  "units_per_box",
] as const;

export interface ParsedRow {
  rowNumber: number;
  name: string;
  sku: string | null;
  type: "NATIONAL" | "CHINA" | null;
  suggestedPriceUzs: number | null;
  costPriceUzs: number | null;
  unitsPerBox: number | null;
  errors: string[];
}

export interface ImportPreview {
  rows: ParsedRow[];
  validCount: number;
  errorCount: number;
}

function cellString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String(value.text).trim();
  if (typeof value === "object" && "result" in value) return String(value.result).trim();
  return String(value).trim();
}

function parseIntOrNull(raw: string): number | null | "invalid" {
  if (raw === "") return null;
  const n = Number(raw.replace(/\s|,/g, ""));
  if (!Number.isFinite(n) || !Number.isInteger(n)) return "invalid";
  return n;
}

/** Parse and validate a workbook buffer into preview rows. */
export function parseProductsWorkbook(rows: Record<string, string>[]): ImportPreview {
  const seenSku = new Set<string>();
  const parsed: ParsedRow[] = rows.map((raw, idx) => {
    const rowNumber = idx + 2; // header is row 1
    const errors: string[] = [];

    const name = (raw.name ?? "").trim();
    if (!name) errors.push("Name is required");

    const skuRaw = (raw.sku ?? "").trim();
    const sku = skuRaw || null;
    if (sku) {
      if (seenSku.has(sku.toLowerCase())) {
        errors.push(`Duplicate SKU "${sku}" within file`);
      }
      seenSku.add(sku.toLowerCase());
    }

    const typeRaw = (raw.type ?? "").trim().toUpperCase();
    let type: "NATIONAL" | "CHINA" | null = null;
    if (typeRaw === "NATIONAL") type = "NATIONAL";
    else if (typeRaw === "CHINA") type = "CHINA";
    else errors.push(`Type must be "National" or "China" (got "${raw.type ?? ""}")`);

    const priceParsed = parseIntOrNull((raw.suggested_price ?? "").trim());
    let suggestedPriceUzs: number | null = null;
    if ((raw.suggested_price ?? "").trim() === "") {
      errors.push("Suggested price is required");
    } else if (priceParsed === "invalid") {
      errors.push("Suggested price must be a whole number");
    } else if (priceParsed !== null && priceParsed < 0) {
      errors.push("Suggested price cannot be negative");
    } else {
      suggestedPriceUzs = priceParsed as number;
    }

    const costParsed = parseIntOrNull((raw.cost_price ?? "").trim());
    let costPriceUzs: number | null = null;
    if (costParsed === "invalid") errors.push("Cost price must be a whole number");
    else costPriceUzs = costParsed;

    const upbParsed = parseIntOrNull((raw.units_per_box ?? "").trim());
    let unitsPerBox: number | null = null;
    if (upbParsed === "invalid") errors.push("Units per box must be a whole number");
    else if (typeof upbParsed === "number" && upbParsed <= 0)
      errors.push("Units per box must be positive");
    else unitsPerBox = upbParsed;

    return { rowNumber, name, sku, type, suggestedPriceUzs, costPriceUzs, unitsPerBox, errors };
  });

  // Drop fully-empty rows (all blank) so trailing rows don't show as errors.
  const meaningful = parsed.filter(
    (r) =>
      r.name ||
      r.sku ||
      r.type ||
      r.suggestedPriceUzs !== null ||
      r.costPriceUzs !== null ||
      r.unitsPerBox !== null,
  );

  const validCount = meaningful.filter((r) => r.errors.length === 0).length;
  return {
    rows: meaningful,
    validCount,
    errorCount: meaningful.length - validCount,
  };
}

/** Read an uploaded .xlsx buffer into raw string rows keyed by column name. */
export async function readWorkbookRows(buffer: Buffer): Promise<Record<string, string>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  // Map header cells -> column keys.
  const headerRow = ws.getRow(1);
  const colMap: Record<number, string> = {};
  headerRow.eachCell((cell, colNumber) => {
    const key = cellString(cell.value).toLowerCase().replace(/\s+/g, "_");
    if ((IMPORT_COLUMNS as readonly string[]).includes(key)) colMap[colNumber] = key;
  });

  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, string> = {};
    for (const [colNumber, key] of Object.entries(colMap)) {
      obj[key] = cellString(row.getCell(Number(colNumber)).value);
    }
    rows.push(obj);
  }
  return rows;
}

/** Build the downloadable .xlsx template with headers and one example row. */
export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Products");
  ws.columns = [
    { header: "name", key: "name", width: 30 },
    { header: "sku", key: "sku", width: 18 },
    { header: "type", key: "type", width: 12 },
    { header: "suggested_price", key: "suggested_price", width: 18 },
    { header: "cost_price", key: "cost_price", width: 14 },
    { header: "units_per_box", key: "units_per_box", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow({
    name: "Example Teddy Bear",
    sku: "TB-001",
    type: "National",
    suggested_price: 75000,
    cost_price: 45000,
    units_per_box: 10,
  });
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}
