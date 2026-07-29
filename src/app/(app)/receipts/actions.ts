"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, products } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { applyMovement } from "@/lib/stock";
import { toUnits, ENTERED_AS, requiredDate } from "@/lib/validation";
import { toFormError, type FormState } from "@/lib/forms";

/**
 * Goods receipt: production → warehouse (§4.2). Multiple products per receipt,
 * entered in units, boxes or bags; the ledger always stores units.
 *
 * The whole receipt is one transaction: either every line lands or none does,
 * so a connection drop cannot leave half a delivery booked in (§14 reliability).
 */

interface ParsedLine {
  productId: string;
  qtyEntered: number;
  enteredAs: (typeof ENTERED_AS)[number];
  qtyUnits: number;
}

export async function createReceiptAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.createReceipt);

    const dateParsed = requiredDate().safeParse(String(formData.get("date") ?? ""));
    if (!dateParsed.success) {
      return { fieldErrors: { date: dateParsed.error.issues[0].message } };
    }
    const movementDate = dateParsed.data;
    const note = String(formData.get("note") ?? "").trim() || null;

    // Lines arrive as parallel arrays from the repeatable form rows.
    const productIds = formData.getAll("productId").map(String);
    const quantities = formData.getAll("qty").map(String);
    const bases = formData.getAll("enteredAs").map(String);

    const wanted = productIds
      .map((productId, i) => ({
        productId,
        qty: quantities[i] ?? "",
        enteredAs: (bases[i] ?? "UNITS") as (typeof ENTERED_AS)[number],
      }))
      // Blank rows are normal — the form always renders a spare one.
      .filter((r) => r.productId && r.qty.trim() !== "" && Number(r.qty) > 0);

    if (wanted.length === 0) return { error: "receipt.enterQty" };

    const packing = await db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        unitsPerBox: products.unitsPerBox,
        unitsPerBag: products.unitsPerBag,
      })
      .from(products)
      .where(inArray(products.id, [...new Set(wanted.map((w) => w.productId))]));
    const byId = new Map(packing.map((p) => [p.id, p]));

    const lines: ParsedLine[] = [];
    for (const w of wanted) {
      const product = byId.get(w.productId);
      if (!product) return { error: "valid.notFound" };
      const qtyEntered = Number(w.qty);
      if (!Number.isInteger(qtyEntered) || qtyEntered <= 0) {
        return { error: "valid.positive" };
      }
      const enteredAs = (ENTERED_AS as readonly string[]).includes(w.enteredAs)
        ? w.enteredAs
        : "UNITS";
      lines.push({
        productId: w.productId,
        qtyEntered,
        enteredAs,
        qtyUnits: toUnits(qtyEntered, enteredAs, product),
      });
    }

    await db.transaction(async (tx) => {
      for (const line of lines) {
        await applyMovement(tx, {
          productId: line.productId,
          type: "RECEIPT",
          qtyUnits: line.qtyUnits,
          movementDate,
          userId: actor.id,
          note,
        });
        const product = byId.get(line.productId)!;
        await writeAudit(
          {
            userId: actor.id,
            entity: "stock",
            entityId: line.productId,
            action: "create",
            label: `${product.sku} — ${product.name}`,
            newValue: {
              type: "RECEIPT",
              qtyUnits: line.qtyUnits,
              enteredAs: line.enteredAs,
              qtyEntered: line.qtyEntered,
              date: movementDate,
            },
          },
          tx,
        );
      }
    });

    revalidatePath("/receipts");
    revalidatePath("/stock");
    revalidatePath("/dashboard");
    revalidatePath("/produce");
    return { ok: true, message: "receipt.saved" };
  } catch (error) {
    return toFormError(error);
  }
}

/**
 * BR-5 support: which accepted orders are waiting on a product, so the
 * warehouseman's dashboard can say "Product X received — order #NNN is
 * waiting". Returns the shortfall per order.
 */
export async function getWaitingOrdersForProduct(productId: string) {
  return db
    .select({
      orderId: orders.id,
      number: orders.number,
      ordered: orderItems.qtyOrderedUnits,
      reserved: orderItems.reservedQty,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.productId, productId),
        inArray(orders.status, ["PICKING", "READY"]),
        sql`${orderItems.reservedQty} < ${orderItems.qtyOrderedUnits}`,
      ),
    );
}
