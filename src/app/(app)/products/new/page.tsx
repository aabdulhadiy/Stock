import { requireDirector } from "@/lib/auth";
import { getT } from "@/i18n/server";
import { listCategories } from "@/lib/queries/products";
import { PageHeader } from "@/components/ui";
import { ProductForm } from "@/components/product-form";

export default async function NewProductPage() {
  await requireDirector();
  const t = await getT();
  const categories = await listCategories();

  return (
    <>
      <PageHeader title={t("product.new")} />
      <ProductForm mode="create" categories={categories} />
    </>
  );
}
