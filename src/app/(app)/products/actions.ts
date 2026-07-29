"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { productImages, products, orderItems, stockMovements } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writeAudit, diffFields } from "@/lib/audit";
import { ensureStockRow } from "@/lib/stock";
import { productSchema, categorySchema } from "@/lib/validation";
import { zodToFieldErrors, toFormError, type FormState } from "@/lib/forms";
import {
  MAX_IMAGE_BYTES,
  deleteUpload,
  isFilled,
  saveImage,
} from "@/lib/uploads";
import { categories } from "@/db/schema";

/**
 * Product catalog mutations (§3). Director only — enforced here, not in the UI,
 * because a Server Action is reachable by direct POST.
 *
 * Price changes are audited old -> new (§12), which is what makes the §4.3
 * "discount frozen stock in one step" flow accountable.
 */

const AUDITED_FIELDS = [
  "sku",
  "name",
  "categoryId",
  "unitsPerBox",
  "unitsPerBag",
  "boxVolumeM3",
  "bagVolumeM3",
  "weightKg",
  "weightBasis",
  "dimLengthCm",
  "dimWidthCm",
  "dimHeightCm",
  "dimsBasis",
  "costPriceCents",
  "marketPriceCents",
  "exportPriceCents",
  "status",
  "minStock",
] as const;

const PRICE_FIELDS = ["costPriceCents", "marketPriceCents", "exportPriceCents"];

function readProductForm(formData: FormData) {
  return {
    sku: String(formData.get("sku") ?? ""),
    name: String(formData.get("name") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
    unitsPerBox: String(formData.get("unitsPerBox") ?? ""),
    unitsPerBag: String(formData.get("unitsPerBag") ?? ""),
    boxVolumeM3: String(formData.get("boxVolumeM3") ?? ""),
    bagVolumeM3: String(formData.get("bagVolumeM3") ?? ""),
    weightKg: String(formData.get("weightKg") ?? ""),
    weightBasis: String(formData.get("weightBasis") ?? "BOX"),
    dimLengthCm: String(formData.get("dimLengthCm") ?? ""),
    dimWidthCm: String(formData.get("dimWidthCm") ?? ""),
    dimHeightCm: String(formData.get("dimHeightCm") ?? ""),
    dimsBasis: String(formData.get("dimsBasis") ?? "BOX"),
    costPriceCents: String(formData.get("costPriceCents") ?? ""),
    marketPriceCents: String(formData.get("marketPriceCents") ?? ""),
    exportPriceCents: String(formData.get("exportPriceCents") ?? ""),
    status: String(formData.get("status") ?? "ACTIVE"),
    minStock: String(formData.get("minStock") ?? ""),
  };
}

/** Store any newly uploaded images against a product. */
async function attachImages(
  productId: string,
  files: File[],
  opts: { makeFirstMain: boolean },
): Promise<FormState | null> {
  if (files.length === 0) return null;

  const [existing] = await db
    .select({ n: sql<number>`count(*)` })
    .from(productImages)
    .where(eq(productImages.productId, productId));
  let sort = Number(existing?.n ?? 0);
  let isFirst = opts.makeFirstMain && sort === 0;

  for (const file of files) {
    const saved = await saveImage(file, "products");
    if (!saved.ok) {
      return {
        fieldErrors: {
          images: saved.error === "SIZE" ? "valid.imageSize" : "valid.imageType",
        },
      };
    }
    await db.insert(productImages).values({
      productId,
      url: saved.upload.url,
      isMain: isFirst,
      sort: sort++,
    });
    isFirst = false;
  }
  return null;
}

function imageFiles(formData: FormData): File[] {
  return formData.getAll("images").filter(isFilled);
}

export async function createProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { user, actor } = await authorize(can.manageProducts);

    const parsed = productSchema.safeParse(readProductForm(formData));
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };
    const data = parsed.data;

    const files = imageFiles(formData);
    if (files.some((f) => f.size > MAX_IMAGE_BYTES)) {
      return { fieldErrors: { images: "valid.imageSize" } };
    }

    const [dupe] = await db
      .select({ id: products.id })
      .from(products)
      .where(sql`lower(${products.sku}) = lower(${data.sku})`);
    if (dupe) return { fieldErrors: { sku: "product.skuTaken" } };

    const productId = await db.transaction(async (tx) => {
      const [row] = await tx.insert(products).values(data).returning({ id: products.id });
      // Create the stock row up front so the reservation lock always has a
      // row to take (see lib/stock.ts).
      await ensureStockRow(tx, row.id);
      await writeAudit(
        {
          userId: actor.id,
          entity: "product",
          entityId: row.id,
          action: "create",
          label: `${data.sku} — ${data.name}`,
          newValue: data,
        },
        tx,
      );
      return row.id;
    });

    const imageError = await attachImages(productId, files, { makeFirstMain: true });
    if (imageError) {
      // The product itself saved; report the image problem without pretending
      // the whole operation failed.
      revalidatePath("/products");
      return { ...imageError, ok: true, message: "product.created" };
    }

    void user;
    revalidatePath("/products");
    revalidatePath("/stock");
    return { ok: true, message: "product.created" };
  } catch (error) {
    return toFormError(error);
  }
}

export async function updateProductAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageProducts);
    const id = String(formData.get("id") ?? "");

    const parsed = productSchema.safeParse(readProductForm(formData));
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };
    const data = parsed.data;

    const [before] = await db.select().from(products).where(eq(products.id, id));
    if (!before) return { error: "valid.notFound" };

    const [dupe] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(sql`lower(${products.sku}) = lower(${data.sku})`, ne(products.id, id)));
    if (dupe) return { fieldErrors: { sku: "product.skuTaken" } };

    const files = imageFiles(formData);

    await db.transaction(async (tx) => {
      await tx
        .update(products)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(products.id, id));

      const diff = diffFields(before, data, [...AUDITED_FIELDS]);
      if (diff) {
        // A price move is logged as its own action so §12's "price changes,
        // old -> new" is filterable, not buried among packing edits.
        const isPriceChange = Object.keys(diff.new).some((k) => PRICE_FIELDS.includes(k));
        await writeAudit(
          {
            userId: actor.id,
            entity: "product",
            entityId: id,
            action: isPriceChange ? "price_change" : "update",
            label: `${data.sku} — ${data.name}`,
            oldValue: diff.old,
            newValue: diff.new,
          },
          tx,
        );
      }
    });

    const imageError = await attachImages(id, files, { makeFirstMain: true });

    revalidatePath("/products");
    revalidatePath(`/products/${id}`);
    revalidatePath("/stock");
    if (imageError) return { ...imageError, ok: true, message: "product.updated" };
    return { ok: true, message: "product.updated" };
  } catch (error) {
    return toFormError(error);
  }
}

/** Archive / restore. Archived products cannot be added to new orders (§3.1). */
export async function setProductStatusAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.manageProducts);
  const id = String(formData.get("id") ?? "");
  const status = formData.get("status") === "ARCHIVED" ? "ARCHIVED" : "ACTIVE";

  const [before] = await db.select().from(products).where(eq(products.id, id));
  if (!before) return;

  await db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({ status, updatedAt: new Date() })
      .where(eq(products.id, id));
    await writeAudit(
      {
        userId: actor.id,
        entity: "product",
        entityId: id,
        action: "update",
        label: `${before.sku} — ${before.name}`,
        oldValue: { status: before.status },
        newValue: { status },
      },
      tx,
    );
  });

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
}

/**
 * Delete a product outright. Only allowed while it has no history at all —
 * otherwise the ledger and past orders would lose their referent, so the
 * Director is told to archive instead.
 */
export async function deleteProductAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.manageProducts);
  const id = String(formData.get("id") ?? "");

  const [before] = await db.select().from(products).where(eq(products.id, id));
  if (!before) return;

  const [{ movements }] = await db
    .select({ movements: sql<number>`count(*)` })
    .from(stockMovements)
    .where(eq(stockMovements.productId, id));
  const [{ lines }] = await db
    .select({ lines: sql<number>`count(*)` })
    .from(orderItems)
    .where(eq(orderItems.productId, id));

  if (Number(movements) > 0 || Number(lines) > 0) {
    // Refuse silently-destructive behaviour; the UI only offers delete when
    // this is empty, and this is the authoritative check.
    return;
  }

  const images = await db
    .select({ url: productImages.url })
    .from(productImages)
    .where(eq(productImages.productId, id));

  await db.transaction(async (tx) => {
    await tx.delete(products).where(eq(products.id, id));
    await writeAudit(
      {
        userId: actor.id,
        entity: "product",
        entityId: id,
        action: "delete",
        label: `${before.sku} — ${before.name}`,
        oldValue: { sku: before.sku, name: before.name },
      },
      tx,
    );
  });

  // Files last: if the transaction rolled back, the images are still referenced.
  for (const image of images) await deleteUpload(image.url);

  revalidatePath("/products");
  revalidatePath("/stock");
}

export async function deleteProductImageAction(formData: FormData): Promise<void> {
  await authorize(can.manageProducts);
  const imageId = String(formData.get("imageId") ?? "");

  const [image] = await db
    .select()
    .from(productImages)
    .where(eq(productImages.id, imageId));
  if (!image) return;

  await db.delete(productImages).where(eq(productImages.id, imageId));

  // Promote another image to primary so a product never loses its thumbnail.
  if (image.isMain) {
    const [next] = await db
      .select({ id: productImages.id })
      .from(productImages)
      .where(eq(productImages.productId, image.productId))
      .orderBy(productImages.sort)
      .limit(1);
    if (next) {
      await db
        .update(productImages)
        .set({ isMain: true })
        .where(eq(productImages.id, next.id));
    }
  }

  await deleteUpload(image.url);
  revalidatePath(`/products/${image.productId}`);
  revalidatePath("/products");
}

export async function setMainImageAction(formData: FormData): Promise<void> {
  await authorize(can.manageProducts);
  const imageId = String(formData.get("imageId") ?? "");

  const [image] = await db
    .select()
    .from(productImages)
    .where(eq(productImages.id, imageId));
  if (!image) return;

  await db.transaction(async (tx) => {
    await tx
      .update(productImages)
      .set({ isMain: false })
      .where(eq(productImages.productId, image.productId));
    await tx
      .update(productImages)
      .set({ isMain: true })
      .where(eq(productImages.id, imageId));
  });

  revalidatePath(`/products/${image.productId}`);
  revalidatePath("/products");
}

// ---------------------------------------------------------------------------
// Categories (§3.1: the Director manages the list)
// ---------------------------------------------------------------------------

export async function createCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageCategories);
    const parsed = categorySchema.safeParse({ name: String(formData.get("name") ?? "") });
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };

    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(categories)
        .values({ name: parsed.data.name })
        .returning({ id: categories.id });
      await writeAudit(
        {
          userId: actor.id,
          entity: "category",
          entityId: row.id,
          action: "create",
          label: parsed.data.name,
        },
        tx,
      );
    });

    revalidatePath("/products/categories");
    revalidatePath("/products");
    return { ok: true, message: "category.created" };
  } catch (error) {
    return toFormError(error);
  }
}

export async function renameCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageCategories);
    const id = String(formData.get("id") ?? "");
    const parsed = categorySchema.safeParse({ name: String(formData.get("name") ?? "") });
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };

    const [before] = await db.select().from(categories).where(eq(categories.id, id));
    if (!before) return { error: "valid.notFound" };

    await db.transaction(async (tx) => {
      await tx
        .update(categories)
        .set({ name: parsed.data.name })
        .where(eq(categories.id, id));
      await writeAudit(
        {
          userId: actor.id,
          entity: "category",
          entityId: id,
          action: "update",
          label: parsed.data.name,
          oldValue: { name: before.name },
          newValue: { name: parsed.data.name },
        },
        tx,
      );
    });

    revalidatePath("/products/categories");
    revalidatePath("/products");
    return { ok: true, message: "category.updated" };
  } catch (error) {
    return toFormError(error);
  }
}

export async function setCategoryActiveAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.manageCategories);
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";

  const [before] = await db.select().from(categories).where(eq(categories.id, id));
  if (!before) return;

  await db.transaction(async (tx) => {
    await tx.update(categories).set({ active }).where(eq(categories.id, id));
    await writeAudit(
      {
        userId: actor.id,
        entity: "category",
        entityId: id,
        action: "update",
        label: before.name,
        oldValue: { active: before.active },
        newValue: { active },
      },
      tx,
    );
  });

  revalidatePath("/products/categories");
  revalidatePath("/products");
}
