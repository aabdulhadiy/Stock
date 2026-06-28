import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getWarehouse, getProductsWithStockAt, getShops } from "@/lib/queries";
import { TransferForm } from "@/components/stock-forms";
import { transferAction } from "../actions";

export default async function TransferPage() {
  const user = await requireUser();
  if (!can.transfer(user)) redirect("/stock");

  const warehouse = await getWarehouse();
  const [withStock, shops] = await Promise.all([
    warehouse ? getProductsWithStockAt(warehouse.id) : Promise.resolve([]),
    getShops(),
  ]);

  // Only offer products that actually have warehouse stock to transfer.
  const products = withStock
    .filter((p) => p.onHand > 0)
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, onHand: p.onHand }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Transfer stock</h1>
        <p className="text-muted text-sm mt-1">
          Move stock from the warehouse to a shop. Applied instantly, no approval needed.
        </p>
      </div>
      {products.length === 0 ? (
        <p className="text-muted text-sm">
          No products currently have warehouse stock to transfer.
        </p>
      ) : (
        <TransferForm action={transferAction} products={products} shops={shops} />
      )}
    </div>
  );
}
