/**
 * Renders one audit entry's change as a compact field-level diff.
 *
 * Amounts are stored in cents, so any `*Cents` field is shown as money —
 * otherwise a price change would read "1200 → 1000" and invite the reader to
 * think in the wrong unit.
 */

/** Entity types the log filter offers; must match `lib/audit.ts`. */
export const AUDIT_ENTITIES: string[] = [
  "product",
  "category",
  "order",
  "order_item",
  "customer",
  "payment",
  "return",
  "expense",
  "expense_category",
  "recurring_expense",
  "user",
  "inventory_count",
  "stock",
  "settings",
];

export const AUDIT_ACTIONS: string[] = [
  "create",
  "update",
  "delete",
  "cancel",
  "status_change",
  "price_change",
  "accept",
  "ship",
  "reserve",
  "adjust",
  "approve",
  "payment",
  "return",
  "login",
  "generate",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (/cents$/i.test(key) && typeof value === "number") {
    return `$${(value / 100).toFixed(2)}`;
  }
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function ChangeCell({
  oldValue,
  newValue,
}: {
  oldValue: unknown;
  newValue: unknown;
}) {
  const before = isRecord(oldValue) ? oldValue : null;
  const after = isRecord(newValue) ? newValue : null;

  if (!before && !after) {
    return <span className="text-xs text-muted">—</span>;
  }

  // Union of both sides, so a field present on only one still shows.
  const keys = [
    ...new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]),
  ];

  return (
    <ul className="space-y-0.5 text-xs">
      {keys.slice(0, 8).map((key) => {
        const from = before?.[key];
        const to = after?.[key];
        const hasBoth = before !== null && after !== null && key in before && key in after;

        return (
          <li key={key} className="font-mono">
            <span className="text-muted">{key}: </span>
            {hasBoth ? (
              <>
                <span className="text-red-700 line-through">{formatValue(key, from)}</span>
                <span className="mx-1 text-muted" aria-label="to">
                  →
                </span>
                <span className="font-semibold text-emerald-700">
                  {formatValue(key, to)}
                </span>
              </>
            ) : (
              <span className={after ? "text-emerald-700" : "text-red-700"}>
                {formatValue(key, after !== undefined ? to : from)}
              </span>
            )}
          </li>
        );
      })}
      {keys.length > 8 && (
        <li className="text-muted">+{keys.length - 8}</li>
      )}
    </ul>
  );
}
