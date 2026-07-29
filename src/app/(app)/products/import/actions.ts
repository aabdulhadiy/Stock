"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { applyMovement, ensureStockRow } from "@/lib/stock";
import { parseImportWorkbook, type ImportProblem, type ImportRow } from "@/lib/import";
import { toFormError, type FormState } from "@/lib/forms";
import { today } from "@/lib/dates";

/**
 * Two-step import (§14). Step one parses and validates without writing
 * anything; step two commits exactly the rows the Director confirmed.
 *
 * The validated rows travel back to the client and are posted again on confirm,
 * so no server-side staging state can go stale between the two steps.
 */

export interface ImportPreviewState extends FormState {
  rows?: ImportRow[];
  problems?: ImportProblem[];
  /** Counts from a completed commit. */
  result?: { created: number; updated: number; stock: number };
}

export async function uploadImportAction(
  _prev: ImportPreviewState,
  formData: FormData,
): Promise<ImportPreviewState> {
  try {
    await authorize(can.importProducts);

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { fieldErrors: { file: "valid.required" } };
    }
    // Excel workbooks for 500 products are well under a megabyte; anything far
    // larger is not a product list.
    if (file.size > 15 * 1024 * 1024) {
      return { fieldErrors: { file: "valid.imageSize" } };
    }

    const parsed = await parseImportWorkbook(Buffer.from(await file.arrayBuffer()));
    if (parsed.unreadable) return { error: "import.badFile" };
    if (parsed.rows.length === 0 && parsed.problems.length === 0) {
      return { error: "import.noRows" };
    }

    return { ok: true, rows: parsed.rows, problems: parsed.problems };
  } catch (error) {
    return toFormError(error);
  }
}

export async function commitImportAction(
  _prev: ImportPreviewState,
  formData: FormData,
): Promise<ImportPreviewState> {
  try {
    const { actor } = await authorize(can.importProducts);

    const payload = String(formData.get("rows") ?? "");
    let rows: ImportRow[];
    try {
      rows = JSON.parse(payload) as ImportRow[];
    } catch {
      return { error: "import.badFile" };
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return { error: "import.nothingValid" };
    }

    const movementDate = today();
    let created = 0;
    let updated = 0;
    let stockRows = 0;

    await db.transaction(async (tx) => {
      // Resolve (and create) categories once, so 500 rows don't re-query.
      const wantedCategories = [
        ...new Set(
          rows
            .map((r) => r.categoryName?.trim())
            .filter((n): n is string => Boolean(n)),
        ),
      ];
      const categoryIdByName = new Map<string, string>();
      if (wantedCategories.length > 0) {
        const existing = await tx.select().from(categories);
        for (const c of existing) categoryIdByName.set(c.name.toLowerCase(), c.id);
        for (const name of wantedCategories) {
          if (categoryIdByName.has(name.toLowerCase())) continue;
          const [row] = await tx
            .insert(categories)
            .values({ name })
            .returning({ id: categories.id });
          categoryIdByName.set(name.toLowerCase(), row.id);
        }
      }

      const skus = rows.map((r) => r.sku.toLowerCase());
      const existingProducts = await tx
        .select({ id: products.id, sku: products.sku })
        .from(products)
        .where(inArray(sql`lower(${products.sku})`, skus));
      const idBySku = new Map(existingProducts.map((p) => [p.sku.toLowerCase(), p.id]));

      for (const row of rows) {
        const values = {
          sku: row.sku,
          name: row.name,
          categoryId: row.categoryName
            ? (categoryIdByName.get(row.categoryName.toLowerCase()) ?? null)
            : null,
          unitsPerBox: row.unitsPerBox,
          unitsPerBag: row.unitsPerBag,
          boxVolumeM3: row.boxVolumeM3,
          bagVolumeM3: row.bagVolumeM3,
          weightKg: row.weightKg,
          weightBasis: row.weightBasis,
          dimLengthCm: row.dimLengthCm,
          dimWidthCm: row.dimWidthCm,
          dimHeightCm: row.dimHeightCm,
          dimsBasis: row.dimsBasis,
          costPriceCents: row.costPriceCents,
          marketPriceCents: row.marketPriceCents,
          exportPriceCents: row.exportPriceCents,
          minStock: row.minStock,
        };

        const existingId = idBySku.get(row.sku.toLowerCase());
        let productId: string;

        if (existingId) {
          await tx
            .update(products)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(products.id, existingId));
          productId = existingId;
          updated++;
        } else {
          const [inserted] = await tx
            .insert(products)
            .values(values)
            .returning({ id: products.id });
          productId = inserted.id;
          await ensureStockRow(tx, productId);
          created++;
        }

        if (row.openingStock > 0) {
          await applyMovement(tx, {
            productId,
            type: "RECEIPT",
            qtyUnits: row.openingStock,
            movementDate,
            userId: actor.id,
            note: "Excel import — opening stock",
          });
          stockRows++;
        }
      }

      await writeAudit(
        {
          userId: actor.id,
          entity: "product",
          action: "create",
          label: `Excel import`,
          newValue: { created, updated, openingStockRows: stockRows, rows: rows.length },
        },
        tx,
      );
    });

    revalidatePath("/products");
    revalidatePath("/stock");
    revalidatePath("/dashboard");

    return {
      ok: true,
      message: "import.done",
      result: { created, updated, stock: stockRows },
    };
  } catch (error) {
    return toFormError(error);
  }
}
