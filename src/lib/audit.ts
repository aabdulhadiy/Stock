import "server-only";
import { db, type Executor } from "@/db";
import { auditLog } from "@/db/schema";

/**
 * The §12 audit trail. Writes are best-effort *within* the caller's
 * transaction: passing the `tx` means a rolled-back operation leaves no
 * misleading audit row, and a successful one is always logged.
 */

export type AuditEntity =
  | "product"
  | "category"
  | "order"
  | "order_item"
  | "customer"
  | "payment"
  | "return"
  | "expense"
  | "expense_category"
  | "recurring_expense"
  | "user"
  | "inventory_count"
  | "stock"
  | "settings";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "cancel"
  | "status_change"
  | "price_change"
  | "accept"
  | "ship"
  | "reserve"
  | "adjust"
  | "approve"
  | "payment"
  | "return"
  | "login"
  | "generate";

export interface AuditInput {
  userId: string | null;
  entity: AuditEntity;
  entityId?: string | null;
  action: AuditAction;
  /** Human-readable subject (SKU, order number, customer name…). */
  label?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

export async function writeAudit(
  input: AuditInput,
  exec: Executor = db,
): Promise<void> {
  await exec.insert(auditLog).values({
    userId: input.userId,
    entity: input.entity,
    entityId: input.entityId ?? null,
    action: input.action,
    label: input.label ?? null,
    oldValue: input.oldValue === undefined ? null : (input.oldValue as object),
    newValue: input.newValue === undefined ? null : (input.newValue as object),
  });
}

export async function writeAuditMany(
  inputs: AuditInput[],
  exec: Executor = db,
): Promise<void> {
  if (inputs.length === 0) return;
  await exec.insert(auditLog).values(
    inputs.map((input) => ({
      userId: input.userId,
      entity: input.entity,
      entityId: input.entityId ?? null,
      action: input.action,
      label: input.label ?? null,
      oldValue: input.oldValue === undefined ? null : (input.oldValue as object),
      newValue: input.newValue === undefined ? null : (input.newValue as object),
    })),
  );
}

/**
 * Diff two records down to the fields that actually changed, so the log stores
 * "market_price: 1200 -> 1000" rather than a full row snapshot. Returns null
 * when nothing changed — the caller can then skip writing an entry at all.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: (keyof T)[],
): { old: Record<string, unknown>; new: Record<string, unknown> } | null {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const a = before[field];
    const b = after[field];
    // Dates and numerics arrive in mixed shapes; compare their string forms.
    if (String(a ?? "") !== String(b ?? "")) {
      oldValues[field as string] = a ?? null;
      newValues[field as string] = b ?? null;
    }
  }
  return Object.keys(newValues).length === 0
    ? null
    : { old: oldValues, new: newValues };
}
