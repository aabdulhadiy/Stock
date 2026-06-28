"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { products } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import {
  parseProductsWorkbook,
  readWorkbookRows,
  type ImportPreview,
} from "@/lib/import";

export interface ImportState {
  phase: "idle" | "preview" | "done";
  error?: string;
  preview?: ImportPreview;
  rawRows?: string; // JSON of Record<string,string>[] for the commit step
  createdCount?: number;
}

/** Flag any row whose SKU already exists in the catalog. */
async function flagExistingSkus(preview: ImportPreview): Promise<ImportPreview> {
  const skus = preview.rows
    .map((r) => r.sku?.toLowerCase())
    .filter((s): s is string => !!s);
  if (skus.length === 0) return preview;

  const existing = await db.select({ sku: products.sku }).from(products);
  const existingSet = new Set(
    existing.map((e) => e.sku?.toLowerCase()).filter(Boolean) as string[],
  );

  let validCount = 0;
  for (const row of preview.rows) {
    if (row.sku && existingSet.has(row.sku.toLowerCase())) {
      row.errors.push(`SKU "${row.sku}" already exists in catalog`);
    }
    if (row.errors.length === 0) validCount++;
  }
  return { rows: preview.rows, validCount, errorCount: preview.rows.length - validCount };
}

export async function previewImport(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  await requireRole("ADMIN");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { phase: "idle", error: "Please choose an .xlsx file" };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { phase: "idle", error: "File must be an .xlsx spreadsheet" };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const rawRows = await readWorkbookRows(buffer);
    if (rawRows.length === 0) {
      return { phase: "idle", error: "No data rows found in the spreadsheet" };
    }
    const preview = await flagExistingSkus(parseProductsWorkbook(rawRows));
    return { phase: "preview", preview, rawRows: JSON.stringify(rawRows) };
  } catch {
    return { phase: "idle", error: "Could not read the spreadsheet. Is it a valid .xlsx file?" };
  }
}

export async function commitImport(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  await requireRole("ADMIN");
  const rawJson = formData.get("rawRows");
  if (typeof rawJson !== "string") {
    return { phase: "idle", error: "Nothing to import — please upload again" };
  }

  let rawRows: Record<string, string>[];
  try {
    rawRows = JSON.parse(rawJson);
  } catch {
    return { phase: "idle", error: "Import data was corrupted — please upload again" };
  }

  // Re-validate from scratch so a stale preview can never write bad rows.
  const preview = await flagExistingSkus(parseProductsWorkbook(rawRows));
  const valid = preview.rows.filter((r) => r.errors.length === 0);
  if (valid.length === 0) {
    return { phase: "preview", preview, rawRows: rawJson, error: "No valid rows to import" };
  }

  await db.insert(products).values(
    valid.map((r) => ({
      name: r.name,
      sku: r.sku,
      type: r.type!,
      suggestedPriceUzs: r.suggestedPriceUzs!,
      costPriceUzs: r.costPriceUzs,
      unitsPerBox: r.unitsPerBox,
      // isActive stays false until stock arrives via the ledger.
    })),
  );

  revalidatePath("/products");
  return { phase: "done", createdCount: valid.length };
}
