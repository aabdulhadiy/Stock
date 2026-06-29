"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button, Input, Label, Select, Textarea, Alert } from "@/components/ui";
import type { FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export interface RegionNode {
  id: string;
  name: string;
  districts: { id: string; name: string }[];
}

export interface CustomerDefaults {
  name?: string;
  phone?: string;
  regionId?: string | null;
  districtId?: string | null;
  notes?: string | null;
}

export function CustomerForm({
  action,
  regions,
  defaults = {},
  submitLabel,
}: {
  action: Action;
  regions: RegionNode[];
  defaults?: CustomerDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [regionId, setRegionId] = useState(defaults.regionId ?? "");
  const fe = state.fieldErrors ?? {};
  const districts = regions.find((r) => r.id === regionId)?.districts ?? [];

  return (
    <form action={formAction} className="space-y-5 max-w-xl">
      {state.error && <Alert variant="error">{state.error}</Alert>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={defaults.name} required />
          {fe.name && <p className="text-xs text-red-600 mt-1">{fe.name}</p>}
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" defaultValue={defaults.phone} required />
          {fe.phone && <p className="text-xs text-red-600 mt-1">{fe.phone}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="regionId">Region (optional)</Label>
          <Select
            id="regionId"
            name="regionId"
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
          >
            <option value="">—</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="districtId">District (optional)</Label>
          <Select
            id="districtId"
            name="districtId"
            defaultValue={defaults.districtId ?? ""}
            disabled={!regionId}
          >
            <option value="">—</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          {fe.districtId && <p className="text-xs text-red-600 mt-1">{fe.districtId}</p>}
        </div>
      </div>

      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" name="notes" rows={2} defaultValue={defaults.notes ?? ""} />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Link href="/customers">
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
