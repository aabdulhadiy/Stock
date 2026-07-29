"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writeAudit, diffFields } from "@/lib/audit";
import { customerSchema, priceTypeForChannel, CHANNELS } from "@/lib/validation";
import { zodToFieldErrors, toFormError, type FormState } from "@/lib/forms";

/** Customer CRUD (§8.1). */

const AUDITED = [
  "name",
  "phone",
  "city",
  "channel",
  "defaultPriceType",
  "defaultTermDays",
  "note",
] as const;

function readForm(formData: FormData) {
  const channel = String(formData.get("channel") ?? "DOMESTIC");
  // §8.1: the default price type follows the channel unless overridden.
  const submitted = String(formData.get("defaultPriceType") ?? "");
  const isValidChannel = (CHANNELS as readonly string[]).includes(channel);
  const fallback = isValidChannel
    ? priceTypeForChannel(channel as (typeof CHANNELS)[number])
    : "MARKET";

  return {
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    city: String(formData.get("city") ?? ""),
    channel,
    defaultPriceType: submitted || fallback,
    defaultTermDays: String(formData.get("defaultTermDays") ?? ""),
    note: String(formData.get("note") ?? ""),
  };
}

export interface CustomerFormState extends FormState {
  /** Returned on success so an inline "new customer" flow can select it. */
  customerId?: string;
  customerName?: string;
}

export async function createCustomerAction(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  try {
    const { actor } = await authorize(can.manageCustomers);

    const parsed = customerSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };
    const data = parsed.data;

    // Phone is the practical identifier here, so a duplicate is worth blocking —
    // but only as a uniqueness warning, not a hard DB constraint, because two
    // shops of one company can legitimately share a number.
    const [dupe] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(sql`regexp_replace(${customers.phone}, '\\D', '', 'g')
                 = regexp_replace(${data.phone}, '\\D', '', 'g')`);
    if (dupe) return { fieldErrors: { phone: "customer.phoneTaken" } };

    const id = await db.transaction(async (tx) => {
      const [row] = await tx.insert(customers).values(data).returning({ id: customers.id });
      await writeAudit(
        {
          userId: actor.id,
          entity: "customer",
          entityId: row.id,
          action: "create",
          label: `${data.name} · ${data.phone}`,
          newValue: data,
        },
        tx,
      );
      return row.id;
    });

    revalidatePath("/customers");
    return {
      ok: true,
      message: "customer.created",
      customerId: id,
      customerName: data.name,
    };
  } catch (error) {
    return toFormError(error);
  }
}

export async function updateCustomerAction(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  try {
    const { actor } = await authorize(can.editCustomers);
    const id = String(formData.get("id") ?? "");

    const parsed = customerSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };
    const data = parsed.data;

    const [before] = await db.select().from(customers).where(eq(customers.id, id));
    if (!before) return { error: "valid.notFound" };

    const [dupe] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          sql`regexp_replace(${customers.phone}, '\\D', '', 'g')
              = regexp_replace(${data.phone}, '\\D', '', 'g')`,
          ne(customers.id, id),
        ),
      );
    if (dupe) return { fieldErrors: { phone: "customer.phoneTaken" } };

    await db.transaction(async (tx) => {
      await tx.update(customers).set(data).where(eq(customers.id, id));
      const diff = diffFields(before, data, [...AUDITED]);
      if (diff) {
        await writeAudit(
          {
            userId: actor.id,
            entity: "customer",
            entityId: id,
            action: "update",
            label: data.name,
            oldValue: diff.old,
            newValue: diff.new,
          },
          tx,
        );
      }
    });

    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    return { ok: true, message: "customer.updated", customerId: id };
  } catch (error) {
    return toFormError(error);
  }
}

/**
 * Deactivate rather than delete once a customer has orders, so order history
 * keeps its counterparty.
 */
export async function setCustomerActiveAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.editCustomers);
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";

  const [before] = await db.select().from(customers).where(eq(customers.id, id));
  if (!before) return;

  await db.transaction(async (tx) => {
    await tx.update(customers).set({ active }).where(eq(customers.id, id));
    await writeAudit(
      {
        userId: actor.id,
        entity: "customer",
        entityId: id,
        action: "update",
        label: before.name,
        oldValue: { active: before.active },
        newValue: { active },
      },
      tx,
    );
  });

  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
}

export async function deleteCustomerAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.editCustomers);
  const id = String(formData.get("id") ?? "");

  const [before] = await db.select().from(customers).where(eq(customers.id, id));
  if (!before) return;

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.customerId, id));
  // Authoritative check: the UI hides the button, but this is what enforces it.
  if (Number(n) > 0) return;

  await db.transaction(async (tx) => {
    await tx.delete(customers).where(eq(customers.id, id));
    await writeAudit(
      {
        userId: actor.id,
        entity: "customer",
        entityId: id,
        action: "delete",
        label: before.name,
        oldValue: { name: before.name, phone: before.phone },
      },
      tx,
    );
  });

  revalidatePath("/customers");
}
