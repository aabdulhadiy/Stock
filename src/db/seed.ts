import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db, closeDb } from "./index";
import { categories, expenseCategories, users } from "./schema";
import { hashPassword } from "@/lib/password";
import { DEFAULT_SETTINGS, saveSettings, getSettings } from "@/lib/settings";

/**
 * Idempotent seed: reference data plus the first Director account. Safe to run
 * repeatedly — every step is "create if absent", so it can be re-run after a
 * restore without duplicating anything.
 */

/** §9.1 seeded default expense categories, with their fixed/variable flag. */
const EXPENSE_CATEGORIES: { name: string; type: "FIXED" | "VARIABLE" }[] = [
  { name: "Salaries", type: "FIXED" },
  { name: "Rent", type: "FIXED" },
  { name: "Utilities (electricity, water)", type: "VARIABLE" },
  { name: "Tax", type: "VARIABLE" },
  { name: "Transport / Logistics", type: "VARIABLE" },
  { name: "Marketing / Advertising", type: "VARIABLE" },
  { name: "Other", type: "VARIABLE" },
];

/** A starting product category list the Director can rename or extend. */
const PRODUCT_CATEGORIES = [
  "Soft toys",
  "Plastic toys",
  "Construction sets",
  "Dolls",
  "Vehicles",
  "Outdoor",
];

async function seedSettings(): Promise<void> {
  const current = await getSettings();
  // getSettings falls back to defaults for missing rows; write them all so the
  // Settings screen shows real, editable rows from the start.
  await saveSettings({ ...DEFAULT_SETTINGS, ...current });
  console.log("  • settings ready");
}

async function seedDirector(): Promise<void> {
  const login = (process.env.SEED_DIRECTOR_LOGIN ?? "director").toLowerCase().trim();
  const password = process.env.SEED_DIRECTOR_PASSWORD ?? "director12345";

  const [existing] = await db.select().from(users).where(eq(users.login, login));
  if (existing) {
    console.log(`  • director "${login}" already exists`);
    return;
  }

  // Only guard the default password — a deliberately chosen one is the
  // operator's call.
  if (!process.env.SEED_DIRECTOR_PASSWORD && process.env.NODE_ENV === "production") {
    console.warn(
      "  ! SEED_DIRECTOR_PASSWORD is not set — refusing to create a Director " +
        "with the well-known default password in production.",
    );
    return;
  }

  await db.insert(users).values({
    login,
    passwordHash: await hashPassword(password),
    name: process.env.SEED_DIRECTOR_NAME ?? "Director",
    role: "DIRECTOR",
    locale: "UZ",
  });
  console.log(`  • created director "${login}"`);
}

async function seedExpenseCategories(): Promise<void> {
  let created = 0;
  for (const cat of EXPENSE_CATEGORIES) {
    const [existing] = await db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(sql`lower(${expenseCategories.name}) = lower(${cat.name})`);
    if (existing) continue;
    await db.insert(expenseCategories).values(cat);
    created++;
  }
  console.log(`  • expense categories: ${created} created, ${EXPENSE_CATEGORIES.length - created} already present`);
}

async function seedProductCategories(): Promise<void> {
  let created = 0;
  for (const name of PRODUCT_CATEGORIES) {
    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(sql`lower(${categories.name}) = lower(${name})`);
    if (existing) continue;
    await db.insert(categories).values({ name });
    created++;
  }
  console.log(`  • product categories: ${created} created`);
}

async function main(): Promise<void> {
  console.log("▶ Seeding reference data");
  await seedSettings();
  await seedDirector();
  await seedExpenseCategories();
  await seedProductCategories();
  console.log("✓ Seed complete");
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("✗ Seed failed:", err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
