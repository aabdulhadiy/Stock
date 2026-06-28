import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const roleEnum = pgEnum("role", ["ADMIN", "WAREHOUSE", "SALES_MANAGER"]);
export const locationTypeEnum = pgEnum("location_type", ["WAREHOUSE", "SHOP"]);
export const productTypeEnum = pgEnum("product_type", ["NATIONAL", "CHINA"]);
export const movementTypeEnum = pgEnum("movement_type", [
  "STOCK_IN", // supplier -> warehouse
  "TRANSFER", // warehouse -> shop
  "SALE_OUT", // shop -> customer (deduction)
  "VOID_RETURN", // customer -> shop (sale voided, stock restored)
]);
export const currencyEnum = pgEnum("currency", ["UZS", "USD"]);
export const saleStatusEnum = pgEnum("sale_status", ["COMPLETED", "VOIDED"]);

// ---------------------------------------------------------------------------
// Reference data: regions / districts (seeded)
// ---------------------------------------------------------------------------
export const regions = pgTable("regions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
});

export const districts = pgTable(
  "districts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    regionId: uuid("region_id")
      .notNull()
      .references(() => regions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [index("districts_region_idx").on(t.regionId)],
);

// ---------------------------------------------------------------------------
// Locations: 1 warehouse + 4 shops
// ---------------------------------------------------------------------------
export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: locationTypeEnum("type").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull(),
  // Shop assignment — required for SALES_MANAGER, null for ADMIN/WAREHOUSE.
  shopId: uuid("shop_id").references(() => locations.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sku: text("sku"),
    type: productTypeEnum("type").notNull(),
    // Single base price in UZS (whole sums; UZS has no practical minor unit).
    suggestedPriceUzs: integer("suggested_price_uzs").notNull(),
    // Admin-only visibility; optional, for margin reporting.
    costPriceUzs: integer("cost_price_uzs"),
    imageUrl: text("image_url"),
    unitsPerBox: integer("units_per_box"),
    // Derived: true while total on-hand across all locations > 0. Maintained
    // by lib/stock.applyMovement; never set manually from the UI.
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("products_sku_unique").on(t.sku)],
);

// ---------------------------------------------------------------------------
// Stock movement ledger — the single source of truth for all stock.
// On-hand for (product, location) == sum of signed deltas of its movements.
// ---------------------------------------------------------------------------
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(), // always positive; direction implied by from/to
    fromLocationId: uuid("from_location_id").references(() => locations.id),
    toLocationId: uuid("to_location_id").references(() => locations.id),
    type: movementTypeEnum("type").notNull(),
    // Links a movement back to the sale that caused it (SALE_OUT / VOID_RETURN).
    saleId: uuid("sale_id"),
    createdById: uuid("created_by_id").references(() => users.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("movements_product_idx").on(t.productId),
    index("movements_from_idx").on(t.fromLocationId),
    index("movements_to_idx").on(t.toLocationId),
  ],
);

// ---------------------------------------------------------------------------
// Cached live balances. Always reconcilable from the ledger; updated inside
// the same transaction as each movement for fast reads.
// ---------------------------------------------------------------------------
export const stockBalances = pgTable(
  "stock_balances",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.locationId] })],
);

// ---------------------------------------------------------------------------
// Customers (central list, shared across shops)
// ---------------------------------------------------------------------------
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone").notNull().unique(),
    regionId: uuid("region_id").references(() => regions.id),
    districtId: uuid("district_id").references(() => districts.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customers_phone_idx").on(t.phone)],
);

// ---------------------------------------------------------------------------
// Exchange rate (UZS per 1 USD) — append-only history.
// ---------------------------------------------------------------------------
export const exchangeRates = pgTable("exchange_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  rate: numeric("rate", { precision: 14, scale: 4 }).notNull(),
  setById: uuid("set_by_id").references(() => users.id),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------
export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => locations.id),
    salesManagerId: uuid("sales_manager_id")
      .notNull()
      .references(() => users.id),
    customerId: uuid("customer_id").references(() => customers.id),
    customerNote: text("customer_note"),
    currency: currencyEnum("currency").notNull(),
    exchangeRateUsed: numeric("exchange_rate_used", { precision: 14, scale: 4 }).notNull(),
    totalAmount: numeric("total_amount", { precision: 16, scale: 2 }).notNull(),
    totalAmountUzs: numeric("total_amount_uzs", { precision: 16, scale: 2 }).notNull(),
    status: saleStatusEnum("status").notNull().default("COMPLETED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sales_shop_idx").on(t.shopId),
    index("sales_manager_idx").on(t.salesManagerId),
    index("sales_created_idx").on(t.createdAt),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    suggestedPrice: numeric("suggested_price", { precision: 16, scale: 2 }).notNull(),
    actualPrice: numeric("actual_price", { precision: 16, scale: 2 }).notNull(),
  },
  (t) => [index("sale_items_sale_idx").on(t.saleId)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const regionsRelations = relations(regions, ({ many }) => ({
  districts: many(districts),
}));
export const districtsRelations = relations(districts, ({ one }) => ({
  region: one(regions, { fields: [districts.regionId], references: [regions.id] }),
}));
export const usersRelations = relations(users, ({ one }) => ({
  shop: one(locations, { fields: [users.shopId], references: [locations.id] }),
}));
export const saleRelations = relations(sales, ({ many, one }) => ({
  items: many(saleItems),
  shop: one(locations, { fields: [sales.shopId], references: [locations.id] }),
  salesManager: one(users, { fields: [sales.salesManagerId], references: [users.id] }),
  customer: one(customers, { fields: [sales.customerId], references: [customers.id] }),
}));
export const saleItemsRelations = relations(saleItems, ({ one }) => ({
  sale: one(sales, { fields: [saleItems.saleId], references: [sales.id] }),
  product: one(products, { fields: [saleItems.productId], references: [products.id] }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type Role = (typeof roleEnum.enumValues)[number];
export type LocationType = (typeof locationTypeEnum.enumValues)[number];
export type ProductType = (typeof productTypeEnum.enumValues)[number];
export type MovementType = (typeof movementTypeEnum.enumValues)[number];
export type Currency = (typeof currencyEnum.enumValues)[number];
export type SaleStatus = (typeof saleStatusEnum.enumValues)[number];

export type User = typeof users.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Product = typeof products.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
