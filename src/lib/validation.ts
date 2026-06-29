import { z } from "zod";

/** Shared zod schemas — used by both client forms and server actions. */

// Treat empty string / null as "absent" before coercion, so an empty numeric
// input becomes undefined rather than 0 (Number("") === 0).
const emptyToUndefined = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v;

const requiredIntUzs = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int("Price must be a whole number of UZS").nonnegative("Price cannot be negative"),
);
const optionalNonnegInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().nonnegative().optional(),
);
const optionalPositiveInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().optional(),
);
const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().url("Enter a valid URL").optional(),
);

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const productTypeSchema = z.enum(["NATIONAL", "CHINA"]);

export const productSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  sku: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v ? v : undefined)),
  type: productTypeSchema,
  suggestedPriceUzs: requiredIntUzs,
  costPriceUzs: optionalNonnegInt,
  unitsPerBox: optionalPositiveInt,
  imageUrl: optionalUrl,
});
export type ProductInput = z.infer<typeof productSchema>;

export const roleSchema = z.enum(["ADMIN", "WAREHOUSE", "SALES_MANAGER"]);

export const userSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().email("Enter a valid email"),
    role: roleSchema,
    shopId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    password: z.string().min(8, "Password must be at least 8 characters"),
  })
  .refine((v) => v.role !== "SALES_MANAGER" || !!v.shopId, {
    message: "Sales managers must be assigned to a shop",
    path: ["shopId"],
  });
export type UserInput = z.infer<typeof userSchema>;

export const stockInSchema = z.object({
  productId: z.string().uuid("Select a product"),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  note: z.string().trim().max(500).optional(),
});
export type StockInInput = z.infer<typeof stockInSchema>;

export const transferSchema = z.object({
  productId: z.string().uuid("Select a product"),
  toLocationId: z.string().uuid("Select a destination shop"),
  quantity: z.coerce.number().int().positive("Quantity must be at least 1"),
  note: z.string().trim().max(500).optional(),
});
export type TransferInput = z.infer<typeof transferSchema>;

// --- Exchange rate ----------------------------------------------------------
export const exchangeRateSchema = z.object({
  rate: z.preprocess(
    emptyToUndefined,
    z.coerce.number().positive("Rate must be greater than 0"),
  ),
});
export type ExchangeRateInput = z.infer<typeof exchangeRateSchema>;

// --- Customers --------------------------------------------------------------
export const customerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().min(3, "Phone is required"),
  regionId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  districtId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional()),
});
export type CustomerInput = z.infer<typeof customerSchema>;

// --- Sales ------------------------------------------------------------------
export const currencySchema = z.enum(["UZS", "USD"]);

export const saleItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  // actualPrice in the sale's chosen currency; defaults to suggested on the client.
  actualPrice: z.coerce.number().nonnegative(),
});

export const saleSchema = z
  .object({
    shopId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    currency: currencySchema,
    customerMode: z.enum(["existing", "new", "other"]),
    customerId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    customerNote: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
    newCustomer: customerSchema.optional(),
    items: z.array(saleItemSchema).min(1, "Add at least one product"),
  })
  .refine((v) => v.customerMode !== "existing" || !!v.customerId, {
    message: "Select a customer",
    path: ["customerId"],
  })
  .refine((v) => v.customerMode !== "new" || !!v.newCustomer, {
    message: "Enter the new customer's details",
    path: ["newCustomer"],
  });
export type SaleInput = z.infer<typeof saleSchema>;
