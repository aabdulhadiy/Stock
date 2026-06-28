"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, Input, Label, Select, Alert } from "@/components/ui";
import type { FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export interface ProductDefaults {
  name?: string;
  sku?: string | null;
  type?: "NATIONAL" | "CHINA";
  suggestedPriceUzs?: number;
  costPriceUzs?: number | null;
  unitsPerBox?: number | null;
  imageUrl?: string | null;
}

export function ProductForm({
  action,
  defaults = {},
  submitLabel,
}: {
  action: Action;
  defaults?: ProductDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5 max-w-xl">
      {state.error && <Alert variant="error">{state.error}</Alert>}

      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={defaults.name} required />
        {fe.name && <p className="text-xs text-red-600 mt-1">{fe.name}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="sku">SKU / Barcode (optional)</Label>
          <Input id="sku" name="sku" defaultValue={defaults.sku ?? ""} />
          {fe.sku && <p className="text-xs text-red-600 mt-1">{fe.sku}</p>}
        </div>
        <div>
          <Label htmlFor="type">Type</Label>
          <Select id="type" name="type" defaultValue={defaults.type ?? "NATIONAL"}>
            <option value="NATIONAL">National</option>
            <option value="CHINA">China</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="suggestedPriceUzs">Suggested price (UZS)</Label>
          <Input
            id="suggestedPriceUzs"
            name="suggestedPriceUzs"
            type="number"
            min={0}
            step={1}
            defaultValue={defaults.suggestedPriceUzs}
            required
          />
          {fe.suggestedPriceUzs && (
            <p className="text-xs text-red-600 mt-1">{fe.suggestedPriceUzs}</p>
          )}
        </div>
        <div>
          <Label htmlFor="costPriceUzs">Cost price (UZS, optional)</Label>
          <Input
            id="costPriceUzs"
            name="costPriceUzs"
            type="number"
            min={0}
            step={1}
            defaultValue={defaults.costPriceUzs ?? ""}
          />
          <p className="text-xs text-muted mt-1">Admin-only; used for margin reports.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="unitsPerBox">Units per box (optional)</Label>
          <Input
            id="unitsPerBox"
            name="unitsPerBox"
            type="number"
            min={1}
            step={1}
            defaultValue={defaults.unitsPerBox ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="imageUrl">Image URL (optional)</Label>
          <Input id="imageUrl" name="imageUrl" defaultValue={defaults.imageUrl ?? ""} />
          {fe.imageUrl && <p className="text-xs text-red-600 mt-1">{fe.imageUrl}</p>}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Link href="/products">
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
