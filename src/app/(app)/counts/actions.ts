"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { inventoryCountItems, inventoryCounts, products } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { applyMovement, getStock } from "@/lib/stock";
import { listProductsWithStock } from "@/lib/queries/products";
import { requiredDate } from "@/lib/validation";
import { toFormError, type FormState } from "@/lib/forms";

/**
 * Inventory counts (§4.5): the warehouseman counts, the Director approves, and
 * only approval moves stock — as an ADJUSTMENT movement, so the variance is
 * visible in the ledger forever rather than silently overwriting a quantity.
 */

export async function createCountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let countId: string;
  try {
    const { actor } = await authorize(can.performCount);

    const dateParsed = requiredDate().safeParse(String(formData.get("countDate") ?? ""));
    if (!dateParsed.success) {
      return { fieldErrors: { countDate: dateParsed.error.issues[0].message } };
    }
    const prefill = formData.get("prefill") === "1";

    countId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(inventoryCounts)
        .values({ countDate: dateParsed.data, status: "DRAFT", userId: actor.id })
        .returning({ id: inventoryCounts.id });

      if (prefill) {
        // Snapshot the book quantity at the moment the sheet is created, so the
        // variance is measured against what the system believed then.
        const withStock = await listProductsWithStock(tx);
        for (const p of withStock) {
          await tx.insert(inventoryCountItems).values({
            countId: row.id,
            productId: p.id,
            countedQty: Number(p.onHand),
            systemQty: Number(p.onHand),
            variance: 0,
          });
        }
      }

      await writeAudit(
        {
          userId: actor.id,
          entity: "inventory_count",
          entityId: row.id,
          action: "create",
          label: dateParsed.data,
        },
        tx,
      );
      return row.id;
    });
  } catch (error) {
    return toFormError(error);
  }

  revalidatePath("/counts");
  redirect(`/counts/${countId}`);
}

/** Save the counted quantities on a draft sheet. */
export async function saveCountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const countId = String(formData.get("id") ?? "");
  try {
    const { actor } = await authorize(can.performCount);

    const [count] = await db
      .select()
      .from(inventoryCounts)
      .where(eq(inventoryCounts.id, countId));
    if (!count) return { error: "valid.notFound" };
    if (count.status !== "DRAFT") return { error: "count.onlyDraftEditable" };

    const itemIds = formData.getAll("itemId").map(String);
    const counted = formData.getAll("countedQty").map(String);

    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(inventoryCountItems)
        .where(eq(inventoryCountItems.countId, countId));
      const byId = new Map(rows.map((r) => [r.id, r]));

      for (let i = 0; i < itemIds.length; i++) {
        const item = byId.get(itemIds[i]);
        if (!item) continue;
        const raw = (counted[i] ?? "").trim();
        if (raw === "" || !/^\d+$/.test(raw)) continue;
        const qty = Number(raw);
        await tx
          .update(inventoryCountItems)
          .set({ countedQty: qty, variance: qty - item.systemQty })
          .where(eq(inventoryCountItems.id, item.id));
      }
    });

    void actor;
    revalidatePath(`/counts/${countId}`);
    return { ok: true, message: "count.saved" };
  } catch (error) {
    return toFormError(error);
  }
}

export async function submitCountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const countId = String(formData.get("id") ?? "");
  try {
    const { actor } = await authorize(can.performCount);

    const [count] = await db
      .select()
      .from(inventoryCounts)
      .where(eq(inventoryCounts.id, countId));
    if (!count) return { error: "valid.notFound" };
    if (count.status !== "DRAFT") return { error: "count.onlyDraftEditable" };

    await db.transaction(async (tx) => {
      await tx
        .update(inventoryCounts)
        .set({ status: "SUBMITTED" })
        .where(eq(inventoryCounts.id, countId));
      await writeAudit(
        {
          userId: actor.id,
          entity: "inventory_count",
          entityId: countId,
          action: "status_change",
          label: count.countDate,
          oldValue: { status: "DRAFT" },
          newValue: { status: "SUBMITTED" },
        },
        tx,
      );
    });

    revalidatePath("/counts");
    revalidatePath(`/counts/${countId}`);
    return { ok: true, message: "count.submitted" };
  } catch (error) {
    return toFormError(error);
  }
}

/**
 * §4.5 approval: the Director signs off and stock is adjusted. Each variance
 * becomes one ADJUSTMENT movement, and the whole approval is audit-logged.
 */
export async function approveCountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const countId = String(formData.get("id") ?? "");
  try {
    const { actor } = await authorize(can.approveCount);

    const [count] = await db
      .select()
      .from(inventoryCounts)
      .where(eq(inventoryCounts.id, countId));
    if (!count) return { error: "valid.notFound" };
    if (count.status !== "SUBMITTED") return { error: "order.statusBlocked" };

    await db.transaction(async (tx) => {
      const items = await tx
        .select()
        .from(inventoryCountItems)
        .where(eq(inventoryCountItems.countId, countId));

      const skuById = new Map(
        (
          await tx
            .select({ id: products.id, sku: products.sku, name: products.name })
            .from(products)
            .where(
              inArray(
                products.id,
                items.map((i) => i.productId),
              ),
            )
        ).map((p) => [p.id, p]),
      );

      let adjusted = 0;
      for (const item of items) {
        // Re-read the live book quantity: stock may have moved since the sheet
        // was filled in, and the physical count is what is true now.
        const live = await getStock(item.productId, tx);
        const delta = item.countedQty - live.onHand;
        if (delta === 0) continue;

        await applyMovement(tx, {
          productId: item.productId,
          type: "ADJUSTMENT",
          qtyUnits: delta,
          movementDate: count.countDate,
          userId: actor.id,
          inventoryCountId: countId,
          note: `Inventory count ${count.countDate}`,
        });

        // Record the variance actually applied, against the live quantity.
        await tx
          .update(inventoryCountItems)
          .set({ systemQty: live.onHand, variance: delta })
          .where(eq(inventoryCountItems.id, item.id));

        const product = skuById.get(item.productId);
        await writeAudit(
          {
            userId: actor.id,
            entity: "stock",
            entityId: item.productId,
            action: "adjust",
            label: product ? `${product.sku} — ${product.name}` : item.productId,
            oldValue: { onHand: live.onHand },
            newValue: { onHand: item.countedQty, variance: delta },
          },
          tx,
        );
        adjusted++;
      }

      await tx
        .update(inventoryCounts)
        .set({ status: "APPROVED", approvedById: actor.id, approvedAt: new Date() })
        .where(eq(inventoryCounts.id, countId));

      await writeAudit(
        {
          userId: actor.id,
          entity: "inventory_count",
          entityId: countId,
          action: "approve",
          label: count.countDate,
          newValue: { adjustedProducts: adjusted, lines: items.length },
        },
        tx,
      );
    });

    revalidatePath("/counts");
    revalidatePath(`/counts/${countId}`);
    revalidatePath("/stock");
    revalidatePath("/dashboard");
    return { ok: true, message: "count.approved" };
  } catch (error) {
    return toFormError(error);
  }
}

export async function cancelCountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const countId = String(formData.get("id") ?? "");
  try {
    const { actor } = await authorize(can.performCount);

    const [count] = await db
      .select()
      .from(inventoryCounts)
      .where(eq(inventoryCounts.id, countId));
    if (!count) return { error: "valid.notFound" };
    if (count.status === "APPROVED") return { error: "order.statusBlocked" };

    await db.transaction(async (tx) => {
      await tx
        .update(inventoryCounts)
        .set({ status: "CANCELLED" })
        .where(eq(inventoryCounts.id, countId));
      await writeAudit(
        {
          userId: actor.id,
          entity: "inventory_count",
          entityId: countId,
          action: "cancel",
          label: count.countDate,
          oldValue: { status: count.status },
          newValue: { status: "CANCELLED" },
        },
        tx,
      );
    });

    revalidatePath("/counts");
    revalidatePath(`/counts/${countId}`);
    return { ok: true, message: "count.cancelled" };
  } catch (error) {
    return toFormError(error);
  }
}

/** Add a product to a draft sheet that was not prefilled. */
export async function addCountLineAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.performCount);
  const countId = String(formData.get("id") ?? "");
  const productId = String(formData.get("productId") ?? "");
  if (!productId) return;

  const [count] = await db
    .select()
    .from(inventoryCounts)
    .where(eq(inventoryCounts.id, countId));
  if (!count || count.status !== "DRAFT") return;

  const stock = await getStock(productId);
  await db
    .insert(inventoryCountItems)
    .values({
      countId,
      productId,
      countedQty: stock.onHand,
      systemQty: stock.onHand,
      variance: 0,
    })
    // Adding the same product twice is a no-op rather than an error.
    .onConflictDoNothing();

  void actor;
  revalidatePath(`/counts/${countId}`);
}
