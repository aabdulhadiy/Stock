"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select, Textarea, Alert, Card, CardBody, Badge } from "@/components/ui";
import { fromUzs, toUzs, formatMoney, round2 } from "@/lib/currency";
import type { Currency } from "@/db/schema";
import type { RegionNode } from "@/components/customer-form";
import { submitSale, searchCustomersAction } from "@/app/(app)/sales/actions";

export interface SaleProduct {
  id: string;
  name: string;
  sku: string | null;
  suggestedPriceUzs: number;
  unitsPerBox: number | null;
  onHand: number;
}
export interface ShopOption {
  id: string;
  name: string;
}
export interface CustomerHit {
  id: string;
  name: string;
  phone: string;
}

interface Line {
  key: number;
  productId: string;
  quantity: number;
  boxes: string;
  actualPrice: number;
}

export function NewSale({
  rate,
  isAdmin,
  shops,
  fixedShop,
  productsByShop,
  regions,
  initialCustomers,
}: {
  rate: number;
  isAdmin: boolean;
  shops: ShopOption[];
  fixedShop: ShopOption | null;
  productsByShop: Record<string, SaleProduct[]>;
  regions: RegionNode[];
  initialCustomers: CustomerHit[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const keyRef = useRef(1);

  const [shopId, setShopId] = useState(fixedShop?.id ?? shops[0]?.id ?? "");
  const [currency, setCurrency] = useState<Currency>("UZS");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Customer
  const [customerMode, setCustomerMode] = useState<"existing" | "new" | "other">("existing");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerHit | null>(null);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<CustomerHit[]>(initialCustomers);
  const [newCust, setNewCust] = useState({ name: "", phone: "", regionId: "", districtId: "", notes: "" });
  const [otherNote, setOtherNote] = useState("");

  const products = useMemo(() => productsByShop[shopId] ?? [], [productsByShop, shopId]);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const districts = regions.find((r) => r.id === newCust.regionId)?.districts ?? [];

  function suggestedFor(productId: string): number {
    const p = productMap.get(productId);
    return p ? fromUzs(p.suggestedPriceUzs, currency, rate) : 0;
  }

  function addProduct(productId: string) {
    if (!productId || lines.some((l) => l.productId === productId)) return;
    setLines((prev) => [
      ...prev,
      { key: keyRef.current++, productId, quantity: 1, boxes: "", actualPrice: suggestedFor(productId) },
    ]);
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function changeCurrency(next: Currency) {
    setCurrency(next);
    // Switching currency recalculates suggested prices; reset overrides to the
    // new suggested value (the old override was in the previous currency).
    setLines((prev) =>
      prev.map((l) => {
        const p = productMap.get(l.productId);
        return { ...l, actualPrice: p ? fromUzs(p.suggestedPriceUzs, next, rate) : 0 };
      }),
    );
  }

  function changeShop(next: string) {
    setShopId(next);
    setLines([]); // products differ per shop
  }

  function setBoxes(line: Line, boxesStr: string) {
    const p = productMap.get(line.productId);
    const n = Number(boxesStr);
    if (p?.unitsPerBox && Number.isFinite(n) && n >= 0) {
      updateLine(line.key, { boxes: boxesStr, quantity: Math.round(n * p.unitsPerBox) });
    } else {
      updateLine(line.key, { boxes: boxesStr });
    }
  }

  const total = round2(lines.reduce((s, l) => s + l.actualPrice * l.quantity, 0));
  const totalUzs = toUzs(total, currency, rate);

  function runCustomerSearch() {
    startTransition(async () => {
      const hits = await searchCustomersAction(custQuery);
      setCustResults(hits.map((h) => ({ id: h.id, name: h.name, phone: h.phone })));
    });
  }

  function validate(): string | null {
    if (!shopId) return "Select a shop";
    if (lines.length === 0) return "Add at least one product";
    for (const l of lines) {
      if (l.quantity < 1) return "Quantities must be at least 1";
      const p = productMap.get(l.productId);
      if (p && l.quantity > p.onHand) return `Not enough stock of ${p.name} (max ${p.onHand})`;
    }
    if (customerMode === "existing" && !selectedCustomer) return "Select a customer";
    if (customerMode === "new" && (!newCust.name.trim() || !newCust.phone.trim()))
      return "Enter the new customer's name and phone";
    return null;
  }

  function submit() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await submitSale({
        shopId,
        currency,
        customerMode,
        customerId: customerMode === "existing" ? selectedCustomer?.id : undefined,
        customerNote: customerMode === "other" ? otherNote : undefined,
        newCustomer:
          customerMode === "new"
            ? {
                name: newCust.name,
                phone: newCust.phone,
                regionId: newCust.regionId || undefined,
                districtId: newCust.districtId || undefined,
                notes: newCust.notes || undefined,
              }
            : undefined,
        items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, actualPrice: l.actualPrice })),
      });
      if (res.ok && res.saleId) router.push(`/sales/${res.saleId}`);
      else setError(res.error ?? "Could not complete the sale");
    });
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="shop">Shop</Label>
          {isAdmin ? (
            <Select id="shop" value={shopId} onChange={(e) => changeShop(e.target.value)}>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : (
            <div className="px-3 py-2 text-sm rounded-md border border-border bg-slate-50">
              {fixedShop?.name}
            </div>
          )}
        </div>
        <div>
          <Label>Currency</Label>
          <div className="flex gap-2">
            {(["UZS", "USD"] as Currency[]).map((c) => (
              <Button
                key={c}
                type="button"
                variant={currency === c ? "primary" : "secondary"}
                onClick={() => changeCurrency(c)}
              >
                {c}
              </Button>
            ))}
            <span className="self-center text-xs text-muted">Rate: {rate.toLocaleString("ru-RU")} UZS/$</span>
          </div>
        </div>
      </div>

      {/* Products */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-end gap-2 max-w-md">
            <div className="flex-1">
              <Label htmlFor="addProduct">Add product</Label>
              <Select id="addProduct" value="" onChange={(e) => addProduct(e.target.value)}>
                <option value="">Select a product in stock…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id} disabled={lines.some((l) => l.productId === p.id)}>
                    {p.name} — {p.onHand} in stock
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {lines.length === 0 ? (
            <p className="text-sm text-muted">No products added yet.</p>
          ) : (
            <div className="space-y-3">
              {lines.map((l) => {
                const p = productMap.get(l.productId)!;
                const suggested = suggestedFor(l.productId);
                const lineTotal = round2(l.actualPrice * l.quantity);
                return (
                  <div key={l.key} className="border border-border rounded-md p-3 grid md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-3">
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted">{p.onHand} in stock</p>
                    </div>
                    {p.unitsPerBox ? (
                      <div className="md:col-span-2">
                        <Label>Boxes ×{p.unitsPerBox}</Label>
                        <Input
                          type="number"
                          min={0}
                          value={l.boxes}
                          onChange={(e) => setBoxes(l, e.target.value)}
                        />
                      </div>
                    ) : (
                      <div className="md:col-span-2" />
                    )}
                    <div className="md:col-span-2">
                      <Label>Qty (pcs)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: Math.max(0, Number(e.target.value)) })}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label>Price ({currency})</Label>
                      <Input
                        type="number"
                        min={0}
                        step={currency === "USD" ? "0.01" : "1"}
                        value={l.actualPrice}
                        onChange={(e) => updateLine(l.key, { actualPrice: Math.max(0, Number(e.target.value)) })}
                      />
                      {round2(l.actualPrice) !== round2(suggested) && (
                        <p className="text-[11px] text-amber-600 mt-0.5">Suggested {formatMoney(suggested, currency)}</p>
                      )}
                    </div>
                    <div className="md:col-span-2 text-right">
                      <p className="text-sm font-medium tabular-nums">{formatMoney(lineTotal, currency)}</p>
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Customer */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex gap-2">
            {(
              [
                ["existing", "Existing customer"],
                ["new", "New customer"],
                ["other", "Other / one-time"],
              ] as const
            ).map(([mode, label]) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                variant={customerMode === mode ? "primary" : "secondary"}
                onClick={() => setCustomerMode(mode)}
              >
                {label}
              </Button>
            ))}
          </div>

          {customerMode === "existing" && (
            <div className="space-y-2 max-w-md">
              <div className="flex gap-2">
                <Input
                  placeholder="Search name or phone…"
                  value={custQuery}
                  onChange={(e) => setCustQuery(e.target.value)}
                />
                <Button type="button" variant="secondary" onClick={runCustomerSearch}>
                  Search
                </Button>
              </div>
              {selectedCustomer ? (
                <p className="text-sm">
                  Selected: <span className="font-medium">{selectedCustomer.name}</span> ({selectedCustomer.phone}){" "}
                  <button className="text-xs text-primary" onClick={() => setSelectedCustomer(null)}>
                    change
                  </button>
                </p>
              ) : (
                <div className="border border-border rounded-md divide-y max-h-48 overflow-auto">
                  {custResults.length === 0 ? (
                    <p className="text-sm text-muted p-2">No customers — try a search or add a new one.</p>
                  ) : (
                    custResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCustomer(c)}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        {c.name} <span className="text-muted">· {c.phone}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {customerMode === "new" && (
            <div className="grid sm:grid-cols-2 gap-3 max-w-2xl">
              <div>
                <Label>Name</Label>
                <Input
                  aria-label="New customer name"
                  value={newCust.name}
                  onChange={(e) => setNewCust({ ...newCust, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  aria-label="New customer phone"
                  value={newCust.phone}
                  onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })}
                />
              </div>
              <div>
                <Label>Region</Label>
                <Select
                  value={newCust.regionId}
                  onChange={(e) => setNewCust({ ...newCust, regionId: e.target.value, districtId: "" })}
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
                <Label>District</Label>
                <Select
                  value={newCust.districtId}
                  onChange={(e) => setNewCust({ ...newCust, districtId: e.target.value })}
                  disabled={!newCust.regionId}
                >
                  <option value="">—</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {customerMode === "other" && (
            <div className="max-w-md">
              <Label>Note (optional, not saved to customer list)</Label>
              <Textarea rows={2} value={otherNote} onChange={(e) => setOtherNote(e.target.value)} />
            </div>
          )}
        </CardBody>
      </Card>

      {/* Totals + submit */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">Total</p>
          <p className="text-2xl font-bold tabular-nums">{formatMoney(total, currency)}</p>
          {currency === "USD" && (
            <p className="text-xs text-muted">
              <Badge>≈ {totalUzs.toLocaleString("ru-RU")} so&apos;m</Badge>
            </p>
          )}
        </div>
        <Button type="button" onClick={submit} disabled={pending || lines.length === 0}>
          {pending ? "Completing…" : "Complete sale"}
        </Button>
      </div>
    </div>
  );
}
