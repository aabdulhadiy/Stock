"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { saleSchema } from "@/lib/validation";
import { createSale, voidSale, SaleError, type CreateSaleInput } from "@/lib/sales";
import { searchCustomers } from "@/lib/queries";

export interface SaleResult {
  ok: boolean;
  saleId?: string;
  error?: string;
}

/** Create a sale from the New Sale form payload. */
export async function submitSale(input: CreateSaleInput): Promise<SaleResult> {
  const user = await requireUser();
  if (!can.recordSale(user)) return { ok: false, error: "You are not allowed to record sales" };

  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid sale" };
  }

  try {
    const saleId = await createSale(user, parsed.data as CreateSaleInput);
    revalidatePath("/sales");
    revalidatePath("/stock");
    revalidatePath("/dashboard");
    return { ok: true, saleId };
  } catch (err) {
    if (err instanceof SaleError) return { ok: false, error: err.message };
    if (err instanceof Error && err.name === "InsufficientStockError") {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}

/** Void a sale (admin or the manager who made it). */
export async function voidSaleAction(saleId: string): Promise<void> {
  const user = await requireUser();
  await voidSale(user, saleId);
  revalidatePath("/sales");
  revalidatePath(`/sales/${saleId}`);
  revalidatePath("/stock");
  revalidatePath("/dashboard");
}

/** Customer search used by the New Sale customer picker. */
export async function searchCustomersAction(q: string) {
  await requireUser();
  return searchCustomers(q, 10);
}
