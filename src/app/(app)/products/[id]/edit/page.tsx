import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getProductById } from "@/lib/queries";
import { ProductForm } from "@/components/product-form";
import { updateProduct } from "../../actions";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN");
  const { id } = await params;
  const product = await getProductById(id);
  if (!product) notFound();

  const action = updateProduct.bind(null, product.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Edit product</h1>
        <p className="text-muted text-sm mt-1">{product.name}</p>
      </div>
      <ProductForm
        action={action}
        submitLabel="Save changes"
        defaults={{
          name: product.name,
          sku: product.sku,
          type: product.type,
          suggestedPriceUzs: product.suggestedPriceUzs,
          costPriceUzs: product.costPriceUzs,
          unitsPerBox: product.unitsPerBox,
          imageUrl: product.imageUrl,
        }}
      />
    </div>
  );
}
