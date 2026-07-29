import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  date,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Data model for the Warehouse & Sales Management System (Tech Spec v2.0,
 * Appendix A). Single warehouse, base currency USD.
 *
 * MONEY: every monetary column is an integer count of **cents** (USD). Integer
 * arithmetic keeps sums and profit math exact — no float drift, no numeric
 * strings to parse. `src/lib/money.ts` owns the conversions at the edges.
 *
 * STOCK: `stock_movements` is the immutable ledger; on-hand is the sum of its
 * signed deltas. `product_stock` caches on-hand + reserved for fast reads and
 * is the row that gets locked to make reservation atomic (BR-9).
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const roleEnum = pgEnum("role", [
  "DIRECTOR",
  "WAREHOUSEMAN",
  "SALESPERSON",
]);

/** UI language per user (§13). Uzbek Latin is the default. */
export const localeEnum = pgEnum("locale", ["UZ", "RU", "EN"]);

/** Which of the two sale prices an order uses (§5.1). */
export const priceTypeEnum = pgEnum("price_type", ["MARKET", "EXPORT"]);

export const productStatusEnum = pgEnum("product_status", ["ACTIVE", "ARCHIVED"]);

/** Whether `weight_kg` / dimensions describe one unit or one box (§3.1). */
export const measureBasisEnum = pgEnum("measure_basis", ["UNIT", "BOX"]);

/** How a line quantity was typed in; stored qty is always units (§5.1). */
export const enteredAsEnum = pgEnum("entered_as", ["UNITS", "BOXES", "BAGS"]);

export const movementTypeEnum = pgEnum("movement_type", [
  "RECEIPT", // production -> warehouse (+)
  "SHIPMENT", // warehouse -> customer (-)
  "ADJUSTMENT", // inventory count approval (+/-)
  "RETURN", // customer -> warehouse (+)
]);

export const orderStatusEnum = pgEnum("order_status", [
  "NEW",
  "PICKING",
  "READY",
  "SHIPPED",
  "CANCELLED",
]);

export const paymentMethodEnum = pgEnum("payment_method", ["CASH", "BANK"]);

export const channelEnum = pgEnum("channel", [
  "EXPORT",
  "DOMESTIC",
  "XAM_XAM",
  "UZUM",
  "OTHER",
]);

export const expenseTypeEnum = pgEnum("expense_type", ["FIXED", "VARIABLE"]);

export const countStatusEnum = pgEnum("count_status", [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "CANCELLED",
]);

// ---------------------------------------------------------------------------
// Users (§2)
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  login: text("login").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull(),
  locale: localeEnum("locale").notNull().default("UZ"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Product catalog (§3)
// ---------------------------------------------------------------------------
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),

    // Packing
    unitsPerBox: integer("units_per_box").notNull(),
    unitsPerBag: integer("units_per_bag"),
    boxVolumeM3: numeric("box_volume_m3", { precision: 12, scale: 6 }).notNull(),
    bagVolumeM3: numeric("bag_volume_m3", { precision: 12, scale: 6 }),

    // Physical measures, with the basis they were measured on
    weightKg: numeric("weight_kg", { precision: 10, scale: 3 }).notNull(),
    weightBasis: measureBasisEnum("weight_basis").notNull().default("BOX"),
    dimLengthCm: numeric("dim_length_cm", { precision: 8, scale: 1 }).notNull(),
    dimWidthCm: numeric("dim_width_cm", { precision: 8, scale: 1 }).notNull(),
    dimHeightCm: numeric("dim_height_cm", { precision: 8, scale: 1 }).notNull(),
    dimsBasis: measureBasisEnum("dims_basis").notNull().default("BOX"),

    // Money — cents (USD). Cost is Director-only at the API layer (§2.2).
    costPriceCents: integer("cost_price_cents").notNull(),
    marketPriceCents: integer("market_price_cents").notNull(),
    exportPriceCents: integer("export_price_cents").notNull(),

    status: productStatusEnum("status").notNull().default("ACTIVE"),
    /** Alert threshold compared against Available (§4.6). */
    minStock: integer("min_stock"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_sku_unique").on(t.sku),
    index("products_name_idx").on(t.name),
    index("products_category_idx").on(t.categoryId),
    index("products_status_idx").on(t.status),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    isMain: boolean("is_main").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

// ---------------------------------------------------------------------------
// Stock ledger (§4) — on_hand(p) = Σ stock_movements.qty_units
// ---------------------------------------------------------------------------
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    type: movementTypeEnum("type").notNull(),
    /** Signed delta in units: RECEIPT/RETURN positive, SHIPMENT negative. */
    qtyUnits: integer("qty_units").notNull(),
    /** Source document, when there is one. */
    orderId: uuid("order_id"),
    returnId: uuid("return_id"),
    inventoryCountId: uuid("inventory_count_id"),
    movementDate: date("movement_date").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("movements_product_idx").on(t.productId),
    index("movements_date_idx").on(t.movementDate),
    index("movements_type_idx").on(t.type),
    index("movements_order_idx").on(t.orderId),
  ],
);

/**
 * Cached stock per product. Rebuildable from the ledger at any time
 * (`recomputeStock`), but authoritative for concurrency: reservation locks this
 * row `FOR UPDATE` so two simultaneous acceptances can never over-reserve the
 * same units (BR-9).
 */
export const productStock = pgTable("product_stock", {
  productId: uuid("product_id")
    .primaryKey()
    .references(() => products.id, { onDelete: "cascade" }),
  onHand: integer("on_hand").notNull().default(0),
  /** Σ order_items.reserved_qty over orders in PICKING / READY. */
  reserved: integer("reserved").notNull().default(0),
  /** Last RECEIPT date — drives "days in warehouse" (§3.2, OQ-2 simplified). */
  lastReceiptDate: date("last_receipt_date"),
  /** Last SHIPMENT date — drives frozen-stock classification (§4.3). */
  lastSaleDate: date("last_sale_date"),
});

// ---------------------------------------------------------------------------
// Customers (§8)
// ---------------------------------------------------------------------------
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    city: text("city"),
    channel: channelEnum("channel").notNull(),
    /** Derived from channel on create; Director may override (§8.1). */
    defaultPriceType: priceTypeEnum("default_price_type").notNull(),
    defaultTermDays: integer("default_term_days"),
    note: text("note"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customers_name_idx").on(t.name),
    index("customers_phone_idx").on(t.phone),
    index("customers_channel_idx").on(t.channel),
  ],
);

// ---------------------------------------------------------------------------
// Orders (§5) — reservation happens on acceptance (§6)
// ---------------------------------------------------------------------------
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    priceType: priceTypeEnum("price_type").notNull(),
    status: orderStatusEnum("status").notNull().default("NEW"),

    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    plannedShipDate: date("planned_ship_date").notNull(),
    actualShipDate: date("actual_ship_date"),

    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    /** 0 = immediate (§5.4). */
    paymentTermDays: integer("payment_term_days").notNull().default(0),
    /** actual_ship_date + term; set when the order ships. */
    dueDate: date("due_date"),

    /** Σ line unit_price × qty, in cents. Maintained with the lines. */
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),

    note: text("note"),

    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedById: uuid("accepted_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("orders_number_unique").on(t.number),
    index("orders_customer_idx").on(t.customerId),
    index("orders_status_idx").on(t.status),
    index("orders_created_idx").on(t.createdAt),
    index("orders_due_idx").on(t.dueDate),
    index("orders_ship_idx").on(t.actualShipDate),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),

    /** Canonical ordered quantity, always in units. */
    qtyOrderedUnits: integer("qty_ordered_units").notNull(),
    /** How the user typed it, kept so the UI can show "5 boxes" not "600". */
    enteredAs: enteredAsEnum("entered_as").notNull().default("UNITS"),
    enteredQty: integer("entered_qty").notNull(),

    /** Actual sold price (cents) — what all analytics use (§5.2). */
    unitPriceCents: integer("unit_price_cents").notNull(),
    /** The catalog price at order time, to measure discounts against. */
    basePriceSnapshotCents: integer("base_price_snapshot_cents").notNull(),

    /** Units held for this line; only non-zero while PICKING/READY/SHIPPED. */
    reservedQty: integer("reserved_qty").notNull().default(0),
    /** Warehouseman ticked this line off physically (§7.2). */
    picked: boolean("picked").notNull().default(false),

    /** Cost frozen at shipping so later cost edits can't rewrite history. */
    costSnapshotCents: integer("cost_snapshot_cents"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_product_idx").on(t.productId),
  ],
);

// ---------------------------------------------------------------------------
// Payments (§5.4)
// ---------------------------------------------------------------------------
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    paidOn: date("paid_on").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    method: paymentMethodEnum("method").notNull(),
    note: text("note"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_order_idx").on(t.orderId),
    index("payments_date_idx").on(t.paidOn),
  ],
);

// ---------------------------------------------------------------------------
// Returns (§11)
// ---------------------------------------------------------------------------
export const returns = pgTable(
  "returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    returnDate: date("return_date").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("returns_order_idx").on(t.orderId),
    index("returns_date_idx").on(t.returnDate),
  ],
);

export const returnItems = pgTable(
  "return_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => returns.id, { onDelete: "cascade" }),
    /** Line the return reverses — carries the price and cost snapshots. */
    orderItemId: uuid("order_item_id").references(() => orderItems.id, {
      onDelete: "set null",
    }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    qtyUnits: integer("qty_units").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    costSnapshotCents: integer("cost_snapshot_cents"),
  },
  (t) => [index("return_items_return_idx").on(t.returnId)],
);

// ---------------------------------------------------------------------------
// Inventory counts (§4.5)
// ---------------------------------------------------------------------------
export const inventoryCounts = pgTable(
  "inventory_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countDate: date("count_date").notNull(),
    status: countStatusEnum("status").notNull().default("DRAFT"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    approvedById: uuid("approved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("counts_status_idx").on(t.status)],
);

export const inventoryCountItems = pgTable(
  "inventory_count_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countId: uuid("count_id")
      .notNull()
      .references(() => inventoryCounts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    countedQty: integer("counted_qty").notNull(),
    /** Book quantity captured when the line was entered. */
    systemQty: integer("system_qty").notNull(),
    variance: integer("variance").notNull(),
  },
  (t) => [
    index("count_items_count_idx").on(t.countId),
    uniqueIndex("count_items_unique").on(t.countId, t.productId),
  ],
);

// ---------------------------------------------------------------------------
// Expenses (§9)
// ---------------------------------------------------------------------------
export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: expenseTypeEnum("type").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expenseDate: date("expense_date").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id, { onDelete: "restrict" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    method: paymentMethodEnum("method").notNull(),
    description: text("description"),
    receiptImageUrl: text("receipt_image_url"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expenses_date_idx").on(t.expenseDate),
    index("expenses_category_idx").on(t.categoryId),
  ],
);

/** Templates for §9.3 "generate this month's fixed expenses". */
export const recurringExpenses = pgTable("recurring_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => expenseCategories.id, { onDelete: "restrict" }),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  method: paymentMethodEnum("method").notNull().default("BANK"),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Audit log (§12)
// ---------------------------------------------------------------------------
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** e.g. "product", "order", "order_item", "expense", "payment". */
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    /** e.g. "create", "update", "cancel", "status_change", "price_change". */
    action: text("action").notNull(),
    /** Human-readable subject, so the log stays useful after deletes. */
    label: text("label"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
  },
  (t) => [
    index("audit_user_idx").on(t.userId),
    index("audit_at_idx").on(t.at),
    index("audit_entity_idx").on(t.entity),
  ],
);

// ---------------------------------------------------------------------------
// Settings (§14) & sequences
// ---------------------------------------------------------------------------
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Gap-free per-year order numbering; incremented under a row lock. */
export const sequences = pgTable("sequences", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  images: many(productImages),
  stock: one(productStock, {
    fields: [products.id],
    references: [productStock.productId],
  }),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

export const productStockRelations = relations(productStock, ({ one }) => ({
  product: one(products, {
    fields: [productStock.productId],
    references: [products.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  createdBy: one(users, {
    fields: [orders.createdById],
    references: [users.id],
  }),
  items: many(orderItems),
  payments: many(payments),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));

export const returnsRelations = relations(returns, ({ one, many }) => ({
  order: one(orders, { fields: [returns.orderId], references: [orders.id] }),
  items: many(returnItems),
}));

export const returnItemsRelations = relations(returnItems, ({ one }) => ({
  ret: one(returns, {
    fields: [returnItems.returnId],
    references: [returns.id],
  }),
  product: one(products, {
    fields: [returnItems.productId],
    references: [products.id],
  }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  category: one(expenseCategories, {
    fields: [expenses.categoryId],
    references: [expenseCategories.id],
  }),
}));

export const recurringExpensesRelations = relations(
  recurringExpenses,
  ({ one }) => ({
    category: one(expenseCategories, {
      fields: [recurringExpenses.categoryId],
      references: [expenseCategories.id],
    }),
  }),
);

export const inventoryCountsRelations = relations(
  inventoryCounts,
  ({ one, many }) => ({
    items: many(inventoryCountItems),
    performedBy: one(users, {
      fields: [inventoryCounts.userId],
      references: [users.id],
    }),
  }),
);

export const inventoryCountItemsRelations = relations(
  inventoryCountItems,
  ({ one }) => ({
    count: one(inventoryCounts, {
      fields: [inventoryCountItems.countId],
      references: [inventoryCounts.id],
    }),
    product: one(products, {
      fields: [inventoryCountItems.productId],
      references: [products.id],
    }),
  }),
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type Role = (typeof roleEnum.enumValues)[number];
export type Locale = (typeof localeEnum.enumValues)[number];
export type PriceType = (typeof priceTypeEnum.enumValues)[number];
export type ProductStatus = (typeof productStatusEnum.enumValues)[number];
export type MeasureBasis = (typeof measureBasisEnum.enumValues)[number];
export type EnteredAs = (typeof enteredAsEnum.enumValues)[number];
export type MovementType = (typeof movementTypeEnum.enumValues)[number];
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type Channel = (typeof channelEnum.enumValues)[number];
export type ExpenseType = (typeof expenseTypeEnum.enumValues)[number];
export type CountStatus = (typeof countStatusEnum.enumValues)[number];

export type User = typeof users.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type ProductStock = typeof productStock.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Return = typeof returns.$inferSelect;
export type ReturnItem = typeof returnItems.$inferSelect;
export type InventoryCount = typeof inventoryCounts.$inferSelect;
export type InventoryCountItem = typeof inventoryCountItems.$inferSelect;
export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type Setting = typeof settings.$inferSelect;
