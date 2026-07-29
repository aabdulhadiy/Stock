"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writeAudit, diffFields } from "@/lib/audit";
import { requiredMoney } from "@/lib/validation";
import { toFormError, type FormState } from "@/lib/forms";

/**
 * §4.3: reprice a non-moving product straight from the frozen list, so
 * discounting is one step rather than a trip through the product form.
 *
 * Recorded as a `price_change` so §12's "price changes, old -> new" filter finds
 * it — a discount decided here is exactly the kind of change that needs to be
 * accountable later.
 */
export async function repriceProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageProducts);
    const id = String(formData.get("id") ?? "");

    const market = requiredMoney().safeParse(String(formData.get("marketPriceCents") ?? ""));
    const exportPrice = requiredMoney().safeParse(
      String(formData.get("exportPriceCents") ?? ""),
    );
    if (!market.success) {
      return { fieldErrors: { marketPriceCents: market.error.issues[0].message } };
    }
    if (!exportPrice.success) {
      return { fieldErrors: { exportPriceCents: exportPrice.error.issues[0].message } };
    }

    const [before] = await db.select().from(products).where(eq(products.id, id));
    if (!before) return { error: "valid.notFound" };

    const next = {
      marketPriceCents: market.data,
      exportPriceCents: exportPrice.data,
    };

    await db.transaction(async (tx) => {
      await tx
        .update(products)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(products.id, id));

      const diff = diffFields(before, next, ["marketPriceCents", "exportPriceCents"]);
      if (diff) {
        await writeAudit(
          {
            userId: actor.id,
            entity: "product",
            entityId: id,
            action: "price_change",
            label: `${before.sku} — ${before.name}`,
            oldValue: diff.old,
            newValue: diff.new,
          },
          tx,
        );
      }
    });

    revalidatePath("/frozen");
    revalidatePath("/products");
    revalidatePath(`/products/${id}`);
    revalidatePath("/stock");
    return { ok: true, message: "frozen.repriced" };
  } catch (error) {
    return toFormError(error);
  }
}
