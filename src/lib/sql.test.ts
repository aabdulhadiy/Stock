import test from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import { db, closeDb } from "@/db";
import { categories, customers, orders, products } from "@/db/schema";
import { col } from "@/lib/sql";

/**
 * Regression tests for correlated subquery references.
 *
 * Interpolating a Drizzle column into a `sql` template only produces a
 * table-qualified name when the outer query happens to have a join. Without
 * one it emits a bare `"id"`, which Postgres resolves in the *inner* scope —
 * silently returning the wrong number, or erroring as ambiguous. Neither shows
 * up in a type check, so `col()` exists and these tests hold it in place.
 */

test.after(async () => {
  await closeDb();
});

test("col() qualifies a column with its table, join or no join", () => {
  const withoutJoin = db
    .select({ n: sql<number>`(SELECT 1 WHERE x = ${col(orders.id)})` })
    .from(orders)
    .toSQL().sql;
  assert.match(withoutJoin, /"orders"\."id"/);

  const withJoin = db
    .select({ n: sql<number>`(SELECT 1 WHERE x = ${col(orders.id)})` })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .toSQL().sql;
  assert.match(withJoin, /"orders"\."id"/);
});

test("bare interpolation is the trap col() exists to avoid", () => {
  // Documented, not endorsed: this is what goes wrong without `col()`.
  const bare = db
    .select({ n: sql<number>`(SELECT 1 WHERE x = ${orders.id})` })
    .from(orders)
    .toSQL().sql;
  assert.ok(
    bare.includes('x = "id"'),
    `expected an unqualified reference, got: ${bare}`,
  );
});

test("the category product count is correlated on the right table", async () => {
  // The bug this catches: `p.category_id = "id"` resolved to products.id,
  // so every category reported 0 products.
  const [category] = await db
    .insert(categories)
    .values({ name: `SQLTEST-${process.pid}` })
    .returning({ id: categories.id });

  const [product] = await db
    .insert(products)
    .values({
      sku: `SQLTEST-${process.pid}`,
      name: "Counted toy",
      categoryId: category.id,
      unitsPerBox: 1,
      boxVolumeM3: "0.001000",
      weightKg: "1.000",
      dimLengthCm: "1.0",
      dimWidthCm: "1.0",
      dimHeightCm: "1.0",
      costPriceCents: 1,
      marketPriceCents: 2,
      exportPriceCents: 3,
    })
    .returning({ id: products.id });

  const { listCategories } = await import("@/lib/queries/products");
  const rows = await listCategories({ includeArchived: true });
  const row = rows.find((r) => r.id === category.id);

  assert.ok(row, "the category is listed");
  assert.equal(row.productCount, 1, "counts products in the category, not all products");

  await db.delete(products).where(eq(products.id, product.id));
  await db.delete(categories).where(eq(categories.id, category.id));
});
