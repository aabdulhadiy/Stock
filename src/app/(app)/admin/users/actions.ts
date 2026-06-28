"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, locations } from "@/db/schema";
import { requireRole, hashPassword } from "@/lib/auth";
import { userSchema } from "@/lib/validation";
import { zodToFieldErrors, type FormState } from "@/lib/forms";

export async function createUser(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole("ADMIN");

  const parsed = userSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    shopId: formData.get("shopId") ?? "",
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Please fix the errors below", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const data = parsed.data;
  const email = data.email.toLowerCase().trim();

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing.length) {
    return { error: "Email already in use", fieldErrors: { email: "Already registered" } };
  }

  // Only sales managers get a shop; clear it for other roles.
  let shopId: string | null = null;
  if (data.role === "SALES_MANAGER") {
    const [shop] = await db.select().from(locations).where(eq(locations.id, data.shopId!));
    if (!shop || shop.type !== "SHOP") {
      return { error: "Invalid shop", fieldErrors: { shopId: "Choose a valid shop" } };
    }
    shopId = shop.id;
  }

  await db.insert(users).values({
    name: data.name,
    email,
    role: data.role,
    shopId,
    passwordHash: await hashPassword(data.password),
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function setUserActive(id: string, isActive: boolean): Promise<void> {
  await requireRole("ADMIN");
  await db.update(users).set({ isActive }).where(eq(users.id, id));
  revalidatePath("/admin/users");
}
