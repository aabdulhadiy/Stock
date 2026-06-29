import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  exchangeRates,
  locations,
  products,
  saleItems,
  sales,
  type Currency,
} from "@/db/schema";
import type { SessionUser } from "@/lib/session";
import { applyMovementTx } from "@/lib/stock";
import { canVoidSale } from "@/lib/permissions";
import { fromUzs, toUzs, saleTotal, round2 } from "@/lib/currency";

/** Currently effective exchange rate (UZS per 1 USD). */
async function currentRate(): Promise<number> {
  const [row] = await db
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.effectiveFrom))
    .limit(1);
  return row ? Number(row.rate) : 0;
}

/**
 * Transactional sales service. A sale and its SALE_OUT stock deductions commit
 * together; if any line lacks stock, applyMovementTx throws and the whole sale
 * rolls back — no sale row, no partial deduction (spec 4.3). Voiding restores
 * stock via VOID_RETURN and flips status, excluding it from revenue (spec 4.4).
 */

export class SaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleError";
  }
}

export interface SaleItemInput {
  productId: string;
  quantity: number;
  actualPrice: number; // in the sale's chosen currency
}

export interface NewCustomerInput {
  name: string;
  phone: string;
  regionId?: string;
  districtId?: string;
  notes?: string;
}

export interface CreateSaleInput {
  shopId?: string; // required for admins; ignored for managers
  currency: Currency;
  customerMode: "existing" | "new" | "other";
  customerId?: string;
  customerNote?: string;
  newCustomer?: NewCustomerInput;
  items: SaleItemInput[];
}

/** Resolve the shop a sale belongs to, honoring role scoping. */
async function resolveShopId(actor: SessionUser, input: CreateSaleInput): Promise<string> {
  if (actor.role === "SALES_MANAGER") {
    if (!actor.shopId) throw new SaleError("Your account is not assigned to a shop");
    return actor.shopId;
  }
  // Admin must pick a shop.
  if (!input.shopId) throw new SaleError("Select a shop for this sale");
  const [shop] = await db.select().from(locations).where(eq(locations.id, input.shopId));
  if (!shop || shop.type !== "SHOP") throw new SaleError("Invalid shop");
  return shop.id;
}

export async function createSale(
  actor: SessionUser,
  input: CreateSaleInput,
): Promise<string> {
  if (input.items.length === 0) throw new SaleError("Add at least one product");

  const shopId = await resolveShopId(actor, input);
  const rate = await currentRate();
  if (!rate || rate <= 0) {
    throw new SaleError("No exchange rate is set — an admin must set one first");
  }

  // Load product base prices up front.
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const prods = await db.select().from(products).where(inArray(products.id, productIds));
  const priceMap = new Map(prods.map((p) => [p.id, p.suggestedPriceUzs]));
  for (const id of productIds) {
    if (!priceMap.has(id)) throw new SaleError("One of the products no longer exists");
  }

  const lines = input.items.map((i) => {
    const suggested = fromUzs(priceMap.get(i.productId)!, input.currency, rate);
    const actual = round2(i.actualPrice);
    return { ...i, suggested, actual };
  });

  const totalAmount = saleTotal(lines.map((l) => ({ quantity: l.quantity, actualPrice: l.actual })));
  const totalAmountUzs = toUzs(totalAmount, input.currency, rate);

  return db.transaction(async (tx) => {
    // Resolve / create the customer.
    let customerId: string | null = null;
    let customerNote: string | null = null;
    if (input.customerMode === "existing") {
      if (!input.customerId) throw new SaleError("Select a customer");
      customerId = input.customerId;
    } else if (input.customerMode === "new") {
      const nc = input.newCustomer;
      if (!nc) throw new SaleError("Enter the new customer's details");
      const existing = await tx.select({ id: customers.id }).from(customers).where(eq(customers.phone, nc.phone));
      if (existing.length) throw new SaleError("A customer with this phone already exists");
      const [created] = await tx
        .insert(customers)
        .values({
          name: nc.name,
          phone: nc.phone,
          regionId: nc.regionId ?? null,
          districtId: nc.districtId ?? null,
          notes: nc.notes ?? null,
        })
        .returning();
      customerId = created.id;
    } else {
      // "Other" / one-time — not saved to the customer list.
      customerNote = input.customerNote ?? null;
    }

    const [sale] = await tx
      .insert(sales)
      .values({
        shopId,
        salesManagerId: actor.sub,
        customerId,
        customerNote,
        currency: input.currency,
        exchangeRateUsed: rate.toString(),
        totalAmount: totalAmount.toString(),
        totalAmountUzs: totalAmountUzs.toString(),
        status: "COMPLETED",
      })
      .returning();

    await tx.insert(saleItems).values(
      lines.map((l) => ({
        saleId: sale.id,
        productId: l.productId,
        quantity: l.quantity,
        suggestedPrice: l.suggested.toString(),
        actualPrice: l.actual.toString(),
      })),
    );

    // Deduct stock from the shop. Guards roll the whole sale back if short.
    for (const l of lines) {
      await applyMovementTx(tx, {
        productId: l.productId,
        quantity: l.quantity,
        fromLocationId: shopId,
        toLocationId: null,
        type: "SALE_OUT",
        saleId: sale.id,
        createdById: actor.sub,
      });
    }

    return sale.id;
  });
}

export async function voidSale(actor: SessionUser, saleId: string): Promise<void> {
  const [sale] = await db.select().from(sales).where(eq(sales.id, saleId));
  if (!sale) throw new SaleError("Sale not found");
  if (sale.status === "VOIDED") throw new SaleError("Sale is already voided");
  if (!canVoidSale(actor, sale)) throw new SaleError("You cannot void this sale");

  const items = await db.select().from(saleItems).where(eq(saleItems.saleId, saleId));

  await db.transaction(async (tx) => {
    await tx.update(sales).set({ status: "VOIDED" }).where(eq(sales.id, saleId));
    // Restore stock to the shop the sale was made from.
    for (const item of items) {
      await applyMovementTx(tx, {
        productId: item.productId,
        quantity: item.quantity,
        fromLocationId: null,
        toLocationId: sale.shopId,
        type: "VOID_RETURN",
        saleId: sale.id,
        createdById: actor.sub,
      });
    }
  });
}
