import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  getCurrentRate,
  getShops,
  getShopStockProducts,
  getRegionTree,
  searchCustomers,
} from "@/lib/queries";
import { db } from "@/db";
import { locations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NewSale, type SaleProduct } from "@/components/new-sale";
import { Alert } from "@/components/ui";

function toSaleProducts(rows: Awaited<ReturnType<typeof getShopStockProducts>>): SaleProduct[] {
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    suggestedPriceUzs: p.suggestedPriceUzs,
    unitsPerBox: p.unitsPerBox,
    onHand: p.onHand,
  }));
}

export default async function NewSalePage() {
  const user = await requireUser();
  if (!can.recordSale(user)) redirect("/sales");

  const isAdmin = user.role === "ADMIN";
  const [rate, regions, initialCustomers] = await Promise.all([
    getCurrentRate(),
    getRegionTree(),
    searchCustomers("", 10),
  ]);

  let shops: { id: string; name: string }[] = [];
  let fixedShop: { id: string; name: string } | null = null;
  const productsByShop: Record<string, SaleProduct[]> = {};

  if (isAdmin) {
    shops = await getShops();
    for (const s of shops) {
      productsByShop[s.id] = toSaleProducts(await getShopStockProducts(s.id));
    }
  } else {
    if (!user.shopId) redirect("/dashboard");
    const [shop] = await db.select().from(locations).where(eq(locations.id, user.shopId));
    if (!shop) redirect("/dashboard");
    fixedShop = { id: shop.id, name: shop.name };
    productsByShop[shop.id] = toSaleProducts(await getShopStockProducts(shop.id));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New sale</h1>
        <p className="text-muted text-sm mt-1">Record a sale from this shop&apos;s stock.</p>
      </div>

      {rate <= 0 ? (
        <Alert variant="error">
          No exchange rate is set. An admin must set one on the Exchange Rate page before sales can be recorded.
        </Alert>
      ) : (
        <NewSale
          rate={rate}
          isAdmin={isAdmin}
          shops={shops}
          fixedShop={fixedShop}
          productsByShop={productsByShop}
          regions={regions}
          initialCustomers={initialCustomers.map((c) => ({ id: c.id, name: c.name, phone: c.phone }))}
        />
      )}
    </div>
  );
}
