import { and, eq, sql } from "drizzle-orm";
import { db, type DB } from "@/db";
import {
  products,
  stockBalances,
  stockMovements,
  type MovementType,
} from "@/db/schema";

/**
 * The stock ledger. ALL quantity changes funnel through applyMovement, which
 * writes an immutable movement row, updates the cached balance, and refreshes
 * the product's derived isActive flag — atomically, in one transaction.
 * On-hand stock is therefore always reconstructable from the ledger and never
 * edited directly. (Spec 3.3, 3.4, §8.)
 */

export class InsufficientStockError extends Error {
  constructor(
    public productId: string,
    public locationId: string,
    public available: number,
    public requested: number,
  ) {
    super(
      `Insufficient stock: requested ${requested} but only ${available} on hand`,
    );
    this.name = "InsufficientStockError";
  }
}

// Drizzle transaction type is structural; this captures "db or tx".
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Executor = DB | Tx;

export interface MovementInput {
  productId: string;
  quantity: number; // always positive
  fromLocationId: string | null;
  toLocationId: string | null;
  type: MovementType;
  createdById?: string | null;
  saleId?: string | null;
  note?: string | null;
}

/** Read current on-hand for a (product, location). */
export async function getOnHand(
  productId: string,
  locationId: string,
  exec: Executor = db,
): Promise<number> {
  const [row] = await exec
    .select({ q: stockBalances.quantity })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.productId, productId),
        eq(stockBalances.locationId, locationId),
      ),
    );
  return row?.q ?? 0;
}

async function adjustBalance(
  exec: Executor,
  productId: string,
  locationId: string,
  delta: number,
): Promise<void> {
  await exec
    .insert(stockBalances)
    .values({ productId, locationId, quantity: delta })
    .onConflictDoUpdate({
      target: [stockBalances.productId, stockBalances.locationId],
      set: { quantity: sql`${stockBalances.quantity} + ${delta}` },
    });
}

async function refreshProductActive(
  exec: Executor,
  productId: string,
): Promise<void> {
  const [row] = await exec
    .select({ total: sql<number>`coalesce(sum(${stockBalances.quantity}), 0)` })
    .from(stockBalances)
    .where(eq(stockBalances.productId, productId));
  const total = Number(row?.total ?? 0);
  await exec
    .update(products)
    .set({ isActive: total > 0, updatedAt: new Date() })
    .where(eq(products.id, productId));
}

/** Apply a movement inside an existing transaction. */
export async function applyMovementTx(
  tx: Tx,
  input: MovementInput,
): Promise<void> {
  if (input.quantity <= 0) {
    throw new Error("Movement quantity must be positive");
  }

  // Decrement source — guard against driving stock negative.
  if (input.fromLocationId) {
    const available = await getOnHand(input.productId, input.fromLocationId, tx);
    if (available < input.quantity) {
      throw new InsufficientStockError(
        input.productId,
        input.fromLocationId,
        available,
        input.quantity,
      );
    }
    await adjustBalance(tx, input.productId, input.fromLocationId, -input.quantity);
  }

  // Increment destination.
  if (input.toLocationId) {
    await adjustBalance(tx, input.productId, input.toLocationId, input.quantity);
  }

  await tx.insert(stockMovements).values({
    productId: input.productId,
    quantity: input.quantity,
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    type: input.type,
    saleId: input.saleId ?? null,
    createdById: input.createdById ?? null,
    note: input.note ?? null,
  });

  await refreshProductActive(tx, input.productId);
}

/** Apply a single movement in its own transaction. */
export async function applyMovement(input: MovementInput): Promise<void> {
  await db.transaction(async (tx) => {
    await applyMovementTx(tx, input);
  });
}

/** Apply several movements atomically (e.g. all line items of a sale). */
export async function applyMovements(inputs: MovementInput[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const input of inputs) {
      await applyMovementTx(tx, input);
    }
  });
}

/**
 * Rebuild stock_balances from the movement ledger. The ledger is authoritative;
 * this reconciles the cache and can be run as a maintenance/verification step.
 */
export async function recomputeBalances(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(stockBalances);
    // Sum signed deltas per (product, location) from the ledger.
    await tx.execute(sql`
      INSERT INTO stock_balances (product_id, location_id, quantity)
      SELECT product_id, location_id, SUM(delta)::int AS quantity FROM (
        SELECT product_id, to_location_id   AS location_id,  quantity AS delta
          FROM stock_movements WHERE to_location_id   IS NOT NULL
        UNION ALL
        SELECT product_id, from_location_id AS location_id, -quantity AS delta
          FROM stock_movements WHERE from_location_id IS NOT NULL
      ) m
      GROUP BY product_id, location_id
    `);
    await tx.execute(sql`
      UPDATE products p SET is_active = COALESCE((
        SELECT SUM(quantity) FROM stock_balances b WHERE b.product_id = p.id
      ), 0) > 0
    `);
  });
}
