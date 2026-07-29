"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writeAudit, diffFields } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { userCreateSchema, userUpdateSchema } from "@/lib/validation";
import { zodToFieldErrors, toFormError, type FormState } from "@/lib/forms";

/**
 * User management (§2.3): the Director creates and deactivates users and resets
 * passwords. Guards here stop the Director from locking everyone out of the
 * system — including themselves.
 */

async function activeDirectorCount(exclude?: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(
      exclude
        ? and(eq(users.role, "DIRECTOR"), eq(users.active, true), ne(users.id, exclude))
        : and(eq(users.role, "DIRECTOR"), eq(users.active, true)),
    );
  return Number(row?.n ?? 0);
}

function readForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    login: String(formData.get("login") ?? "").toLowerCase(),
    role: String(formData.get("role") ?? ""),
    locale: String(formData.get("locale") ?? "UZ"),
    password: String(formData.get("password") ?? ""),
  };
}

export async function createUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageUsers);
    const parsed = userCreateSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };
    const data = parsed.data;

    const [dupe] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.login}) = lower(${data.login})`);
    if (dupe) return { fieldErrors: { login: "user.loginTaken" } };

    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          name: data.name,
          login: data.login,
          role: data.role,
          locale: data.locale,
          passwordHash: await hashPassword(data.password),
        })
        .returning({ id: users.id });
      await writeAudit(
        {
          userId: actor.id,
          entity: "user",
          entityId: row.id,
          action: "create",
          label: `${data.login} (${data.role})`,
          // Never the password, not even its hash.
          newValue: { name: data.name, login: data.login, role: data.role },
        },
        tx,
      );
    });

    revalidatePath("/admin/users");
    return { ok: true, message: "user.created" };
  } catch (error) {
    return toFormError(error);
  }
}

export async function updateUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageUsers);
    const id = String(formData.get("id") ?? "");

    const parsed = userUpdateSchema.safeParse(readForm(formData));
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };
    const data = parsed.data;

    const [before] = await db.select().from(users).where(eq(users.id, id));
    if (!before) return { error: "valid.notFound" };

    // Changing your own role could strip your own access mid-session.
    if (id === actor.id && data.role !== before.role) {
      return { error: "user.cannotDemoteSelf" };
    }
    // Demoting the last Director would leave nobody able to administer.
    if (
      before.role === "DIRECTOR" &&
      data.role !== "DIRECTOR" &&
      (await activeDirectorCount(id)) === 0
    ) {
      return { error: "user.lastDirector" };
    }

    const [dupe] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.login}) = lower(${data.login})`, ne(users.id, id)));
    if (dupe) return { fieldErrors: { login: "user.loginTaken" } };

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          name: data.name,
          login: data.login,
          role: data.role,
          locale: data.locale,
          ...(data.password ? { passwordHash: await hashPassword(data.password) } : {}),
        })
        .where(eq(users.id, id));

      const diff = diffFields(
        before,
        {
          name: data.name,
          login: data.login,
          role: data.role,
          locale: data.locale,
        },
        ["name", "login", "role", "locale"],
      );
      const changes = diff ?? { old: {}, new: {} };
      if (data.password) {
        // Record that a reset happened, never the value.
        changes.new.passwordHash = "(reset)";
      }
      if (Object.keys(changes.new).length > 0) {
        await writeAudit(
          {
            userId: actor.id,
            entity: "user",
            entityId: id,
            action: "update",
            label: data.login,
            oldValue: changes.old,
            newValue: changes.new,
          },
          tx,
        );
      }
    });

    revalidatePath("/admin/users");
    return { ok: true, message: data.password ? "user.passwordReset" : "user.updated" };
  } catch (error) {
    return toFormError(error);
  }
}

export async function setUserActiveAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.manageUsers);
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";

  const [before] = await db.select().from(users).where(eq(users.id, id));
  if (!before) return;

  // Deactivating yourself, or the last Director, would lock the system.
  if (!active && id === actor.id) return;
  if (
    !active &&
    before.role === "DIRECTOR" &&
    (await activeDirectorCount(id)) === 0
  ) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx.update(users).set({ active }).where(eq(users.id, id));
    await writeAudit(
      {
        userId: actor.id,
        entity: "user",
        entityId: id,
        action: "update",
        label: before.login,
        oldValue: { active: before.active },
        newValue: { active },
      },
      tx,
    );
  });

  revalidatePath("/admin/users");
}
