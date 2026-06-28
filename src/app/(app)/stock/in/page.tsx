import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/db";
import { products } from "@/db/schema";
import { StockInForm } from "@/components/stock-forms";
import { stockInAction } from "../actions";

export default async function StockInPage() {
  const user = await requireUser();
  if (!can.stockIn(user)) redirect("/stock");

  const list = await db
    .select({ id: products.id, name: products.name, sku: products.sku })
    .from(products)
    .orderBy(products.name);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Stock in</h1>
        <p className="text-muted text-sm mt-1">
          Receive stock from a supplier into the central warehouse.
        </p>
      </div>
      <StockInForm action={stockInAction} products={list} />
    </div>
  );
}
