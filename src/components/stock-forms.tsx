"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Input, Label, Select, Textarea, Alert } from "@/components/ui";
import type { FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
  onHand?: number;
}

function ProductSelect({
  products,
  showStock,
  error,
}: {
  products: ProductOption[];
  showStock?: boolean;
  error?: string;
}) {
  return (
    <div>
      <Label htmlFor="productId">Product</Label>
      <Select id="productId" name="productId" required defaultValue="">
        <option value="" disabled>
          Select a product…
        </option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.sku ? ` (${p.sku})` : ""}
            {showStock ? ` — ${p.onHand ?? 0} in warehouse` : ""}
          </option>
        ))}
      </Select>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

export function StockInForm({
  action,
  products,
}: {
  action: Action;
  products: ProductOption[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);
  const fe = state.fieldErrors ?? {};

  return (
    <form ref={ref} action={formAction} className="space-y-4 max-w-lg">
      {state.ok && <Alert variant="success">Stock received and added to the warehouse.</Alert>}
      {state.error && <Alert variant="error">{state.error}</Alert>}
      <ProductSelect products={products} error={fe.productId} />
      <div>
        <Label htmlFor="quantity">Quantity received (pcs)</Label>
        <Input id="quantity" name="quantity" type="number" min={1} step={1} required />
        {fe.quantity && <p className="text-xs text-red-600 mt-1">{fe.quantity}</p>}
      </div>
      <div>
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea id="note" name="note" rows={2} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Receive stock"}
      </Button>
    </form>
  );
}

export function TransferForm({
  action,
  products,
  shops,
}: {
  action: Action;
  products: ProductOption[];
  shops: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);
  const fe = state.fieldErrors ?? {};

  return (
    <form ref={ref} action={formAction} className="space-y-4 max-w-lg">
      {state.ok && <Alert variant="success">Stock transferred to the shop.</Alert>}
      {state.error && <Alert variant="error">{state.error}</Alert>}
      <ProductSelect products={products} showStock error={fe.productId} />
      <div>
        <Label htmlFor="toLocationId">Destination shop</Label>
        <Select id="toLocationId" name="toLocationId" required defaultValue="">
          <option value="" disabled>
            Select a shop…
          </option>
          {shops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        {fe.toLocationId && <p className="text-xs text-red-600 mt-1">{fe.toLocationId}</p>}
      </div>
      <div>
        <Label htmlFor="quantity">Quantity to transfer (pcs)</Label>
        <Input id="quantity" name="quantity" type="number" min={1} step={1} required />
        {fe.quantity && <p className="text-xs text-red-600 mt-1">{fe.quantity}</p>}
      </div>
      <div>
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea id="note" name="note" rows={2} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Transferring…" : "Transfer stock"}
      </Button>
    </form>
  );
}
