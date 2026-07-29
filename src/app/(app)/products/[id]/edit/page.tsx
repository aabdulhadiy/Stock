import { notFound } from "next/navigation";
import { requireDirector } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { getProductRow, listCategories } from "@/lib/queries/products";
import { PageHeader } from "@/components/ui";
import { ProductForm } from "@/components/product-form";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireDirector();
  const t = await getT();
  const { id } = await params;

  const [row, categories] = await Promise.all([
    getProductRow(id, user.role),
    listCategories(),
  ]);
  if (!row) notFound();

  const p = row.product;
  return (
    <>
      <PageHeader title={t("product.edit")} subtitle={`${p.sku} — ${p.name}`} />
      <ProductForm
        mode="edit"
        categories={categories}
        values={{
          id: p.id,
          sku: p.sku,
          name: p.name,
          categoryId: p.categoryId,
          unitsPerBox: p.unitsPerBox,
          unitsPerBag: p.unitsPerBag,
          boxVolumeM3: p.boxVolumeM3,
          bagVolumeM3: p.bagVolumeM3,
          weightKg: p.weightKg,
          weightBasis: p.weightBasis,
          dimLengthCm: p.dimLengthCm,
          dimWidthCm: p.dimWidthCm,
          dimHeightCm: p.dimHeightCm,
          dimsBasis: p.dimsBasis,
          costPriceCents: p.costPriceCents,
          marketPriceCents: p.marketPriceCents,
          exportPriceCents: p.exportPriceCents,
          status: p.status,
          minStock: p.minStock,
        }}
      />
    </>
  );
}
