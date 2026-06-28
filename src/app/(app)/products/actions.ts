"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { productSchema } from "@/lib/validation";
import { zodToFieldErrors, type FormState } from "@/lib/forms";

function parseForm(formData: FormData) {
  return productSchema.safeParse({
    name: formData.get("name"),
    sku: formData.get("sku") ?? "",
    type: formData.get("type"),
    suggestedPriceUzs: formData.get("suggestedPriceUzs"),
    costPriceUzs: formData.get("costPriceUzs") ?? "",
    unitsPerBox: formData.get("unitsPerBox") ?? "",
    imageUrl: formData.get("imageUrl") ?? "",
  });
}

/** SKU must be unique among products (ignoring the row being edited). */
async function skuTaken(sku: string, excludeId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(
      excludeId
        ? and(eq(products.sku, sku), ne(products.id, excludeId))
        : eq(products.sku, sku),
    );
  return rows.length > 0;
}

export async function createProduct(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole("ADMIN");
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const data = parsed.data;
  if (data.sku && (await skuTaken(data.sku))) {
    return { error: "SKU already exists", fieldErrors: { sku: "This SKU is already in use" } };
  }

  await db.insert(products).values({
    name: data.name,
    sku: data.sku ?? null,
    type: data.type,
    suggestedPriceUzs: data.suggestedPriceUzs,
    costPriceUzs: data.costPriceUzs ?? null,
    unitsPerBox: data.unitsPerBox ?? null,
    imageUrl: data.imageUrl ?? null,
    // isActive stays false until stock arrives via the ledger.
  });
  revalidatePath("/products");
  redirect("/products");
}

export async function updateProduct(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole("ADMIN");
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const data = parsed.data;
  if (data.sku && (await skuTaken(data.sku, id))) {
    return { error: "SKU already exists", fieldErrors: { sku: "This SKU is already in use" } };
  }

  await db
    .update(products)
    .set({
      name: data.name,
      sku: data.sku ?? null,
      type: data.type,
      suggestedPriceUzs: data.suggestedPriceUzs,
      costPriceUzs: data.costPriceUzs ?? null,
      unitsPerBox: data.unitsPerBox ?? null,
      imageUrl: data.imageUrl ?? null,
      updatedAt: new Date(),
    })
    .where(eq(products.id, id));
  revalidatePath("/products");
  redirect("/products");
}
