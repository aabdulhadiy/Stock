import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "./index";
import {
  districts,
  exchangeRates,
  locations,
  regions,
  users,
} from "./schema";
import { REGIONS } from "./seed-data";

/**
 * Idempotent seed: reference regions/districts, the warehouse + 4 shops, an
 * admin user, and an initial exchange rate. Safe to re-run.
 */
async function main() {
  console.log("Seeding database...");

  // --- Regions & districts -------------------------------------------------
  for (const r of REGIONS) {
    const existing = await db
      .select()
      .from(regions)
      .where(eq(regions.code, r.code));
    let regionId: string;
    if (existing.length) {
      regionId = existing[0].id;
    } else {
      const [created] = await db
        .insert(regions)
        .values({ name: r.name, code: r.code })
        .returning();
      regionId = created.id;
      const rows = r.districts.map((name) => ({ regionId, name }));
      if (rows.length) await db.insert(districts).values(rows);
    }
  }
  const [{ count: regionCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(regions);
  console.log(`  regions: ${regionCount}`);

  // --- Locations: 1 warehouse + 4 shops -----------------------------------
  const locationSeed = [
    { type: "WAREHOUSE" as const, name: "Central Warehouse" },
    { type: "SHOP" as const, name: "Shop 1" },
    { type: "SHOP" as const, name: "Shop 2" },
    { type: "SHOP" as const, name: "Shop 3" },
    { type: "SHOP" as const, name: "Shop 4" },
  ];
  for (const loc of locationSeed) {
    const existing = await db
      .select()
      .from(locations)
      .where(eq(locations.name, loc.name));
    if (!existing.length) {
      await db.insert(locations).values(loc);
    }
  }
  console.log(`  locations: ${locationSeed.length}`);

  // --- Admin user ----------------------------------------------------------
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@toy.local").toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin12345";
  const existingAdmin = await db
    .select()
    .from(users)
    .where(eq(users.email, adminEmail));
  let adminId: string;
  if (existingAdmin.length) {
    adminId = existingAdmin[0].id;
    console.log(`  admin exists: ${adminEmail}`);
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const [admin] = await db
      .insert(users)
      .values({
        email: adminEmail,
        passwordHash,
        name: "Administrator",
        role: "ADMIN",
      })
      .returning();
    adminId = admin.id;
    console.log(`  admin created: ${adminEmail} / ${adminPassword}`);
  }

  // --- Initial exchange rate ----------------------------------------------
  const existingRate = await db.select().from(exchangeRates).limit(1);
  if (!existingRate.length) {
    const rate = process.env.SEED_EXCHANGE_RATE ?? "12600";
    await db.insert(exchangeRates).values({ rate, setById: adminId });
    console.log(`  exchange rate seeded: ${rate} UZS/USD`);
  }

  console.log("Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
