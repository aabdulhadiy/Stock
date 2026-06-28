import { requireRole } from "@/lib/auth";
import { ProductForm } from "@/components/product-form";
import { createProduct } from "../actions";

export default async function NewProductPage() {
  await requireRole("ADMIN");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New product</h1>
        <p className="text-muted text-sm mt-1">Add a single product to the catalog.</p>
      </div>
      <ProductForm action={createProduct} submitLabel="Create product" />
    </div>
  );
}
