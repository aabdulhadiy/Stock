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
