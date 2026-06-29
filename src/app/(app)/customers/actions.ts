"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { customers, districts } from "@/db/schema";
import { requireUser, requireRole } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { customerSchema } from "@/lib/validation";
import { zodToFieldErrors, type FormState } from "@/lib/forms";

function parse(formData: FormData) {
  return customerSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    regionId: formData.get("regionId") ?? "",
    districtId: formData.get("districtId") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

/** Phone is the unique customer identifier (spec 3.5). */
async function phoneTaken(phone: string, excludeId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      excludeId
        ? and(eq(customers.phone, phone), ne(customers.id, excludeId))
        : eq(customers.phone, phone),
    );
  return rows.length > 0;
}

/** A district must belong to the chosen region. */
async function districtValid(districtId: string, regionId?: string): Promise<boolean> {
  const [d] = await db.select().from(districts).where(eq(districts.id, districtId));
  return !!d && (!regionId || d.regionId === regionId);
}

export async function createCustomer(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  if (!can.manageCustomers(user)) return { error: "Not allowed" };

  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const data = parsed.data;
  if (await phoneTaken(data.phone)) {
    return { error: "Phone already exists", fieldErrors: { phone: "A customer with this phone exists" } };
  }
  if (data.districtId && !(await districtValid(data.districtId, data.regionId))) {
    return { error: "Invalid district", fieldErrors: { districtId: "District does not match region" } };
  }

  await db.insert(customers).values({
    name: data.name,
    phone: data.phone,
    regionId: data.regionId ?? null,
    districtId: data.districtId ?? null,
    notes: data.notes ?? null,
  });
  revalidatePath("/customers");
  redirect("/customers");
}

export async function updateCustomer(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireRole("ADMIN");
  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const data = parsed.data;
  if (await phoneTaken(data.phone, id)) {
    return { error: "Phone already exists", fieldErrors: { phone: "A customer with this phone exists" } };
  }
  if (data.districtId && !(await districtValid(data.districtId, data.regionId))) {
    return { error: "Invalid district", fieldErrors: { districtId: "District does not match region" } };
  }

  await db
    .update(customers)
    .set({
      name: data.name,
      phone: data.phone,
      regionId: data.regionId ?? null,
      districtId: data.districtId ?? null,
      notes: data.notes ?? null,
    })
    .where(eq(customers.id, id));
  revalidatePath("/customers");
  redirect("/customers");
}
