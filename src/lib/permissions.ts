import type { Role } from "@/db/schema";
import type { SessionUser } from "@/lib/session";

/**
 * Single source of truth for the spec §6 permission matrix. Reused by both the
 * UI (to hide/disable) and server actions (to authorize). UI gating is a
 * convenience; the authoritative checks run server-side on every mutation.
 */

export const can = {
  manageProducts: (u: SessionUser) => u.role === "ADMIN",
  viewCostPrice: (u: SessionUser) => u.role === "ADMIN",
  importProducts: (u: SessionUser) => u.role === "ADMIN",
  manageUsers: (u: SessionUser) => u.role === "ADMIN",
  manageExchangeRate: (u: SessionUser) => u.role === "ADMIN",

  stockIn: (u: SessionUser) => u.role === "ADMIN" || u.role === "WAREHOUSE",
  transfer: (u: SessionUser) => u.role === "ADMIN" || u.role === "WAREHOUSE",
  viewWarehouseStock: (u: SessionUser) =>
    u.role === "ADMIN" || u.role === "WAREHOUSE",

  // Admins may also record sales (choosing the shop); managers sell their own.
  recordSale: (u: SessionUser) => u.role === "ADMIN" || u.role === "SALES_MANAGER",
  manageCustomers: (u: SessionUser) =>
    u.role === "ADMIN" || u.role === "SALES_MANAGER",
  // Editing existing customer records is admin-only; managers add/search in-sale.
  editCustomers: (u: SessionUser) => u.role === "ADMIN",

  // Can this user act on (sell/transfer into) a given shop?
  actOnShop: (u: SessionUser, shopId: string) =>
    u.role === "SALES_MANAGER" && u.shopId === shopId,

  // Reports across all shops are Admin-only; managers see their own shop.
  viewAllReports: (u: SessionUser) => u.role === "ADMIN",
  viewShopReports: (u: SessionUser, shopId: string) =>
    u.role === "ADMIN" || (u.role === "SALES_MANAGER" && u.shopId === shopId),
};

/** A sale may be voided by an admin or by the manager who created it (spec 4.4). */
export function canVoidSale(
  user: SessionUser,
  sale: { salesManagerId: string },
): boolean {
  return user.role === "ADMIN" || user.sub === sale.salesManagerId;
}

/** Roles allowed to reach a top-level section (coarse gate for middleware/nav). */
export const SECTION_ROLES: Record<string, Role[]> = {
  "/admin": ["ADMIN"],
  "/products": ["ADMIN", "WAREHOUSE", "SALES_MANAGER"],
  "/stock": ["ADMIN", "WAREHOUSE", "SALES_MANAGER"],
  "/sales": ["ADMIN", "SALES_MANAGER"],
  "/customers": ["ADMIN", "SALES_MANAGER"],
  "/reports": ["ADMIN", "SALES_MANAGER"],
};

export function roleLabel(role: Role): string {
  switch (role) {
    case "ADMIN":
      return "Admin";
    case "WAREHOUSE":
      return "Warehouse";
    case "SALES_MANAGER":
      return "Sales Manager";
  }
}
