import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, count } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  categories,
  productImages,
  productStock,
  products,
  type ProductStatus,
  type Role,
} from "@/db/schema";
import { toProductView, toStockView, type ProductView, type StockView } from "@/lib/dto";
import { movementStatusFor } from "@/lib/labels";
import { daysSince, today } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { col } from "@/lib/sql";

/**
 * Read queries for the catalog and the stock overview (§3, §4.1).
 *
 * Everything returns role-scoped views built by `lib/dto.ts`, so a
 * warehouseman's payload never carries a price — including in the raw response
 * a browser devtools panel would show (§2.2, Phase 1 acceptance).
 *
 * §14 asks the stock screen to stay under 2 s at 500+ products, so the list is
 * a single join with the stock cache and pagination, not N+1 lookups.
 */

export interface ProductListOptions {
  search?: string;
  categoryId?: string | null;
  status?: ProductStatus | "ALL";
  movement?: "NORMAL" | "SLOW" | "FROZEN" | "ALL";
  belowMinimumOnly?: boolean;
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
}

export type ProductSort =
  | "sku"
  | "name"
  | "onHand"
  | "available"
  | "reserved"
  | "daysInWarehouse"
  | "lastSale"
  | "valueAtCost";

export const DEFAULT_PAGE_SIZE = 50;

/** The shared select: product columns, its category, stock, and main image. */
function baseSelect(exec: Executor) {
  const mainImage = sql<string | null>`(
    SELECT pi.url FROM product_images pi
     WHERE pi.product_id = ${col(products.id)}
     ORDER BY pi.is_main DESC, pi.sort ASC, pi.created_at ASC
     LIMIT 1
  )`;

  return exec
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      categoryId: products.categoryId,
      categoryName: categories.name,
      unitsPerBox: products.unitsPerBox,
      unitsPerBag: products.unitsPerBag,
      boxVolumeM3: products.boxVolumeM3,
      bagVolumeM3: products.bagVolumeM3,
      weightKg: products.weightKg,
      weightBasis: products.weightBasis,
      dimLengthCm: products.dimLengthCm,
      dimWidthCm: products.dimWidthCm,
      dimHeightCm: products.dimHeightCm,
      dimsBasis: products.dimsBasis,
      costPriceCents: products.costPriceCents,
      marketPriceCents: products.marketPriceCents,
      exportPriceCents: products.exportPriceCents,
      status: products.status,
      minStock: products.minStock,
      createdAt: products.createdAt,
      mainImageUrl: mainImage,
      onHand: sql<number>`COALESCE(${productStock.onHand}, 0)`,
      reserved: sql<number>`COALESCE(${productStock.reserved}, 0)`,
      lastReceiptDate: productStock.lastReceiptDate,
      lastSaleDate: productStock.lastSaleDate,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(productStock, eq(productStock.productId, products.id));
}

type BaseRow = Awaited<ReturnType<typeof baseSelect>>[number];

export interface ProductRow {
  product: ProductView;
  stock: StockView;
}

function buildRow(row: BaseRow, role: Role, opts: { slowDays: number; frozenDays: number }): ProductRow {
  const now = today();
  const onHand = Number(row.onHand);
  const reserved = Number(row.reserved);
  const available = onHand - reserved;
  const daysInWarehouse = daysSince(row.lastReceiptDate, now);
  const daysSinceSale = daysSince(row.lastSaleDate, now);

  const product = toProductView(
    {
      id: row.id,
      sku: row.sku,
      name: row.name,
      categoryId: row.categoryId,
      categoryName: row.categoryName ?? null,
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
      status: row.status,
      minStock: row.minStock,
      createdAt: row.createdAt,
      mainImageUrl: row.mainImageUrl,
      costPriceCents: row.costPriceCents,
      marketPriceCents: row.marketPriceCents,
      exportPriceCents: row.exportPriceCents,
    },
    role,
  );

  const stock = toStockView(
    {
      productId: row.id,
      sku: row.sku,
      name: row.name,
      categoryName: row.categoryName ?? null,
      mainImageUrl: row.mainImageUrl,
      unitsPerBox: row.unitsPerBox,
      onHand,
      reserved,
      available,
      minStock: row.minStock,
      belowMinimum: row.minStock !== null && available < row.minStock,
      daysInWarehouse,
      lastSaleDate: row.lastSaleDate,
      daysSinceSale,
      movement: movementStatusFor(
        daysSinceSale,
        daysInWarehouse,
        opts.slowDays,
        opts.frozenDays,
      ),
      // Stock value uses on-hand: it is the capital actually sitting in the
      // warehouse, reserved or not.
      valueAtCostCents: onHand * row.costPriceCents,
      valueAtMarketCents: onHand * row.marketPriceCents,
    },
    role,
  );

  return { product, stock };
}

export interface ProductListResult {
  rows: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export async function listProducts(
  role: Role,
  options: ProductListOptions = {},
  exec: Executor = db,
): Promise<ProductListResult> {
  const settings = await getSettings(exec);
  const {
    search,
    categoryId,
    status = "ACTIVE",
    movement = "ALL",
    belowMinimumOnly = false,
    sort = "name",
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  } = options;

  const conditions = [];
  if (status !== "ALL") conditions.push(eq(products.status, status));
  if (categoryId) conditions.push(eq(products.categoryId, categoryId));
  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    conditions.push(or(ilike(products.sku, term), ilike(products.name, term)));
  }
  if (belowMinimumOnly) {
    conditions.push(
      sql`${products.minStock} IS NOT NULL
          AND COALESCE(${productStock.onHand}, 0) - COALESCE(${productStock.reserved}, 0)
              < ${products.minStock}`,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  // Movement status depends on settings thresholds, so it is filtered after
  // the rows are built. Everything else is filtered in SQL.
  const filteringInMemory = movement !== "ALL";

  const orderBy = (() => {
    const available = sql`COALESCE(${productStock.onHand}, 0) - COALESCE(${productStock.reserved}, 0)`;
    switch (sort) {
      case "sku":
        return [asc(products.sku)];
      case "onHand":
        return [desc(sql`COALESCE(${productStock.onHand}, 0)`), asc(products.name)];
      case "reserved":
        return [desc(sql`COALESCE(${productStock.reserved}, 0)`), asc(products.name)];
      case "available":
        return [desc(available), asc(products.name)];
      case "daysInWarehouse":
        return [asc(sql`${productStock.lastReceiptDate} NULLS LAST`), asc(products.name)];
      case "lastSale":
        return [asc(sql`${productStock.lastSaleDate} NULLS FIRST`), asc(products.name)];
      case "valueAtCost":
        return [
          desc(sql`COALESCE(${productStock.onHand}, 0) * ${products.costPriceCents}`),
          asc(products.name),
        ];
      case "name":
      default:
        return [asc(products.name)];
    }
  })();

  if (filteringInMemory) {
    // Load the filtered set and paginate after classification. Bounded by the
    // catalog size (hundreds of products), so this stays well inside §14.
    const all = await baseSelect(exec).where(where).orderBy(...orderBy);
    const built = all
      .map((r) => buildRow(r, role, settings))
      .filter((r) => r.stock.movement === movement);
    const start = Math.max(0, (page - 1) * pageSize);
    return {
      rows: built.slice(start, start + pageSize),
      total: built.length,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(built.length / pageSize)),
    };
  }

  const [countRow] = await exec
    .select({ n: count() })
    .from(products)
    .leftJoin(productStock, eq(productStock.productId, products.id))
    .where(where);
  const total = Number(countRow?.n ?? 0);

  const rows = await baseSelect(exec)
    .where(where)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset(Math.max(0, (page - 1) * pageSize));

  return {
    rows: rows.map((r) => buildRow(r, role, settings)),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** One product, role-scoped, with all of its images. */
export async function getProductRow(
  id: string,
  role: Role,
  exec: Executor = db,
): Promise<(ProductRow & { images: { id: string; url: string; isMain: boolean }[] }) | null> {
  const settings = await getSettings(exec);
  const [row] = await baseSelect(exec).where(eq(products.id, id));
  if (!row) return null;

  const images = await exec
    .select({ id: productImages.id, url: productImages.url, isMain: productImages.isMain })
    .from(productImages)
    .where(eq(productImages.productId, id))
    .orderBy(desc(productImages.isMain), asc(productImages.sort), asc(productImages.createdAt));

  return { ...buildRow(row, role, settings), images };
}

/** Raw product record, for actions that need the un-projected row. */
export async function getProductRaw(id: string, exec: Executor = db) {
  const [row] = await exec.select().from(products).where(eq(products.id, id));
  return row ?? null;
}

export async function findProductBySku(sku: string, exec: Executor = db) {
  const [row] = await exec
    .select()
    .from(products)
    .where(sql`lower(${products.sku}) = lower(${sku})`);
  return row ?? null;
}

/**
 * Lightweight options for order/receipt pickers: identity, packing and current
 * availability. Sale prices are included only for roles allowed to see them.
 */
export interface ProductPickerOption {
  id: string;
  sku: string;
  name: string;
  unitsPerBox: number;
  unitsPerBag: number | null;
  available: number;
  onHand: number;
  marketPriceCents?: number;
  exportPriceCents?: number;
}

export async function listProductOptions(
  role: Role,
  opts: { includeArchived?: boolean } = {},
  exec: Executor = db,
): Promise<ProductPickerOption[]> {
  const rows = await exec
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      unitsPerBox: products.unitsPerBox,
      unitsPerBag: products.unitsPerBag,
      marketPriceCents: products.marketPriceCents,
      exportPriceCents: products.exportPriceCents,
      onHand: sql<number>`COALESCE(${productStock.onHand}, 0)`,
      reserved: sql<number>`COALESCE(${productStock.reserved}, 0)`,
    })
    .from(products)
    .leftJoin(productStock, eq(productStock.productId, products.id))
    .where(opts.includeArchived ? undefined : eq(products.status, "ACTIVE"))
    .orderBy(asc(products.name));

  const canSeePrices = role === "DIRECTOR" || role === "SALESPERSON";

  return rows.map((r) => {
    const option: ProductPickerOption = {
      id: r.id,
      sku: r.sku,
      name: r.name,
      unitsPerBox: r.unitsPerBox,
      unitsPerBag: r.unitsPerBag,
      onHand: Number(r.onHand),
      available: Number(r.onHand) - Number(r.reserved),
    };
    if (canSeePrices) {
      option.marketPriceCents = r.marketPriceCents;
      option.exportPriceCents = r.exportPriceCents;
    }
    return option;
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(
  opts: { includeArchived?: boolean } = {},
  exec: Executor = db,
): Promise<{ id: string; name: string; active: boolean; productCount: number }[]> {
  const rows = await exec
    .select({
      id: categories.id,
      name: categories.name,
      active: categories.active,
      productCount: sql<number>`(
        SELECT COUNT(*) FROM products p WHERE p.category_id = ${col(categories.id)}
      )`,
    })
    .from(categories)
    .where(opts.includeArchived ? undefined : eq(categories.active, true))
    .orderBy(asc(categories.name));

  return rows.map((r) => ({ ...r, productCount: Number(r.productCount) }));
}

// ---------------------------------------------------------------------------
// Dashboard support
// ---------------------------------------------------------------------------

/** Products whose Available has fallen below their minimum (§4.6). */
export async function getLowStockAlerts(
  exec: Executor = db,
): Promise<{ productId: string; sku: string; name: string; available: number; minStock: number }[]> {
  const rows = await exec
    .select({
      productId: products.id,
      sku: products.sku,
      name: products.name,
      onHand: sql<number>`COALESCE(${productStock.onHand}, 0)`,
      reserved: sql<number>`COALESCE(${productStock.reserved}, 0)`,
      minStock: products.minStock,
    })
    .from(products)
    .leftJoin(productStock, eq(productStock.productId, products.id))
    .where(
      and(
        eq(products.status, "ACTIVE"),
        sql`${products.minStock} IS NOT NULL`,
        sql`COALESCE(${productStock.onHand}, 0) - COALESCE(${productStock.reserved}, 0) < ${products.minStock}`,
      ),
    )
    .orderBy(asc(products.name));

  return rows.map((r) => ({
    productId: r.productId,
    sku: r.sku,
    name: r.name,
    available: Number(r.onHand) - Number(r.reserved),
    minStock: r.minStock!,
  }));
}

/** Total value at cost of stock classified as Frozen (§4.3, dashboard tile). */
export async function getFrozenSummary(
  exec: Executor = db,
): Promise<{ count: number; valueAtCostCents: number }> {
  const settings = await getSettings(exec);
  const rows = await exec
    .select({
      onHand: sql<number>`COALESCE(${productStock.onHand}, 0)`,
      costPriceCents: products.costPriceCents,
      lastSaleDate: productStock.lastSaleDate,
      lastReceiptDate: productStock.lastReceiptDate,
    })
    .from(products)
    .leftJoin(productStock, eq(productStock.productId, products.id))
    .where(and(eq(products.status, "ACTIVE"), sql`COALESCE(${productStock.onHand}, 0) > 0`));

  const now = today();
  let n = 0;
  let value = 0;
  for (const r of rows) {
    const status = movementStatusFor(
      daysSince(r.lastSaleDate, now),
      daysSince(r.lastReceiptDate, now),
      settings.slowDays,
      settings.frozenDays,
    );
    if (status === "FROZEN") {
      n++;
      value += Number(r.onHand) * r.costPriceCents;
    }
  }
  return { count: n, valueAtCostCents: value };
}

/** Products with stock, used to pre-fill an inventory count sheet. */
export async function listProductsWithStock(exec: Executor = db) {
  return exec
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      onHand: sql<number>`COALESCE(${productStock.onHand}, 0)`,
    })
    .from(products)
    .leftJoin(productStock, eq(productStock.productId, products.id))
    .where(sql`COALESCE(${productStock.onHand}, 0) <> 0`)
    .orderBy(asc(products.name));
}

export async function productsByIds(ids: string[], exec: Executor = db) {
  if (ids.length === 0) return [];
  return exec.select().from(products).where(inArray(products.id, ids));
}
