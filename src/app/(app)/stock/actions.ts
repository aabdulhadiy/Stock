"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { locations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { applyMovement, InsufficientStockError } from "@/lib/stock";
import { getWarehouse } from "@/lib/queries";
import { stockInSchema, transferSchema } from "@/lib/validation";
import { zodToFieldErrors, type FormState } from "@/lib/forms";

export async function stockInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  if (!can.stockIn(user)) return { error: "You are not allowed to receive stock" };

  const parsed = stockInSchema.safeParse({
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { error: "Please fix the errors below", fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const warehouse = await getWarehouse();
  if (!warehouse) return { error: "No warehouse configured" };

  await applyMovement({
    productId: parsed.data.productId,
    quantity: parsed.data.quantity,
    fromLocationId: null,
    toLocationId: warehouse.id,
    type: "STOCK_IN",
    createdById: user.sub,
    note: parsed.data.note || null,
  });

  revalidatePath("/stock");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function transferAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  if (!can.transfer(user)) return { error: "You are not allowed to transfer stock" };

  const parsed = transferSchema.safeParse({
    productId: formData.get("productId"),
    toLocationId: formData.get("toLocationId"),
    quantity: formData.get("quantity"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { error: "Please fix the errors below", fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const warehouse = await getWarehouse();
  if (!warehouse) return { error: "No warehouse configured" };

  // Destination must be an active shop.
  const [dest] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, parsed.data.toLocationId));
  if (!dest || dest.type !== "SHOP") {
    return { error: "Destination must be a shop", fieldErrors: { toLocationId: "Choose a shop" } };
  }

  try {
    await applyMovement({
      productId: parsed.data.productId,
      quantity: parsed.data.quantity,
      fromLocationId: warehouse.id,
      toLocationId: dest.id,
      type: "TRANSFER",
      createdById: user.sub,
      note: parsed.data.note || null,
    });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return {
        error: `Not enough warehouse stock — only ${err.available} on hand`,
        fieldErrors: { quantity: `Max ${err.available}` },
      };
    }
    throw err;
  }

  revalidatePath("/stock");
  revalidatePath("/dashboard");
  return { ok: true };
}
