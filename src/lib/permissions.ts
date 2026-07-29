import type { Role } from "@/db/schema";

/**
 * The §2.2 permission matrix, in one place, used by both the UI (to hide) and
 * every server action / query (to authorize). UI gating is a convenience; the
 * authoritative checks run server-side.
 *
 * §2.2 is emphatic that hiding fields in the UI is NOT acceptable — so this
 * module also owns the money-visibility predicates that the DTO layer in
 * `lib/dto.ts` uses to strip fields out of payloads entirely, before they ever
 * leave the server.
 */

export interface Actor {
  id: string;
  role: Role;
}

const DIRECTOR_ONLY = (a: Actor) => a.role === "DIRECTOR";

export const can = {
  // --- Catalog -------------------------------------------------------------
  viewProducts: () => true,
  manageProducts: DIRECTOR_ONLY,
  manageCategories: DIRECTOR_ONLY,
  importProducts: DIRECTOR_ONLY,

  /** Cost price and margins: Director only (§2.2). */
  seeCost: DIRECTOR_ONLY,
  /** Market & export prices: Director full, Salesperson read, Warehouseman none. */
  seeSalePrices: (a: Actor) => a.role === "DIRECTOR" || a.role === "SALESPERSON",
  /** Stock values in $: Director only (§2.2). */
  seeStockValue: DIRECTOR_ONLY,

  // --- Warehouse -----------------------------------------------------------
  viewStock: () => true,
  createReceipt: (a: Actor) => a.role === "WAREHOUSEMAN" || a.role === "DIRECTOR",
  performCount: (a: Actor) => a.role === "WAREHOUSEMAN" || a.role === "DIRECTOR",
  approveCount: DIRECTOR_ONLY,

  // --- Orders --------------------------------------------------------------
  createOrder: (a: Actor) => a.role === "DIRECTOR" || a.role === "SALESPERSON",
  /** Editing and cancelling: Director on any order, Salesperson on own only. */
  editOrder: (a: Actor, order: { createdById: string | null }) =>
    a.role === "DIRECTOR" ||
    (a.role === "SALESPERSON" && order.createdById === a.id),
  cancelOrder: (a: Actor, order: { createdById: string | null }) =>
    a.role === "DIRECTOR" ||
    (a.role === "SALESPERSON" && order.createdById === a.id),
  /** Accept / pick / ship — the warehouse's job (§2.2). */
  fulfilOrder: (a: Actor) => a.role === "WAREHOUSEMAN" || a.role === "DIRECTOR",
  /** Salespeople see only their own orders (§2.1). */
  viewAllOrders: (a: Actor) => a.role !== "SALESPERSON",

  // --- Customers -----------------------------------------------------------
  viewCustomers: (a: Actor) => a.role !== "WAREHOUSEMAN",
  manageCustomers: (a: Actor) => a.role === "DIRECTOR" || a.role === "SALESPERSON",
  editCustomers: DIRECTOR_ONLY,

  // --- Money ---------------------------------------------------------------
  managePayments: DIRECTOR_ONLY,
  viewReceivables: DIRECTOR_ONLY,
  manageReturns: DIRECTOR_ONLY,
  manageExpenses: DIRECTOR_ONLY,

  // --- Analytics -----------------------------------------------------------
  viewFullReports: DIRECTOR_ONLY,
  /** Warehouseman: stock-quantity lists only. Salesperson: own sales only. */
  viewQuantityReports: () => true,
  viewProfit: DIRECTOR_ONLY,
  viewAudit: DIRECTOR_ONLY,

  // --- Admin ---------------------------------------------------------------
  manageUsers: DIRECTOR_ONLY,
  manageSettings: DIRECTOR_ONLY,
};

/** Shorthands used by the DTO layer, which only knows a role. */
export function canSeeCost(role: Role): boolean {
  return can.seeCost({ id: "", role });
}

export function canSeeSalePrices(role: Role): boolean {
  return can.seeSalePrices({ id: "", role });
}

export function canSeeStockValue(role: Role): boolean {
  return can.seeStockValue({ id: "", role });
}

/**
 * Roles allowed to reach a top-level section — the coarse gate applied in
 * `proxy.ts`. Fine-grained checks still run in every action and query.
 *
 * Longest matching prefix wins, so `/orders/queue` can be warehouse-only while
 * `/orders` stays open to salespeople.
 */
export const SECTION_ROLES: Record<string, Role[]> = {
  "/dashboard": ["DIRECTOR", "WAREHOUSEMAN", "SALESPERSON"],

  "/products": ["DIRECTOR", "WAREHOUSEMAN", "SALESPERSON"],
  "/stock": ["DIRECTOR", "WAREHOUSEMAN", "SALESPERSON"],
  "/receipts": ["DIRECTOR", "WAREHOUSEMAN"],
  "/counts": ["DIRECTOR", "WAREHOUSEMAN"],
  "/produce": ["DIRECTOR", "WAREHOUSEMAN"],
  "/frozen": ["DIRECTOR"],

  "/queue": ["DIRECTOR", "WAREHOUSEMAN"],
  "/orders": ["DIRECTOR", "WAREHOUSEMAN", "SALESPERSON"],

  "/customers": ["DIRECTOR", "SALESPERSON"],
  "/receivables": ["DIRECTOR"],
  "/returns": ["DIRECTOR"],
  "/expenses": ["DIRECTOR"],
  "/reports": ["DIRECTOR", "SALESPERSON"],
  "/audit": ["DIRECTOR"],
  "/admin": ["DIRECTOR"],
  "/settings": ["DIRECTOR"],
};

/** The roles allowed on a path, or null when the path is not gated. */
export function sectionRoles(pathname: string): Role[] | null {
  let best: { prefix: string; roles: Role[] } | null = null;
  for (const [prefix, roles] of Object.entries(SECTION_ROLES)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      if (!best || prefix.length > best.prefix.length) best = { prefix, roles };
    }
  }
  return best?.roles ?? null;
}

export function isPathAllowed(pathname: string, role: Role): boolean {
  const roles = sectionRoles(pathname);
  return roles === null || roles.includes(role);
}
