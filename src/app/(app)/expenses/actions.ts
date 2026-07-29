"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { expenseCategories, expenses, recurringExpenses } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { writeAudit, diffFields } from "@/lib/audit";
import {
  expenseCategorySchema,
  expenseSchema,
  recurringExpenseSchema,
} from "@/lib/validation";
import { isFilled, saveImage, deleteUpload, MAX_IMAGE_BYTES } from "@/lib/uploads";
import { endOfMonth, monthKey, startOfMonth, today } from "@/lib/dates";
import { msg, zodToFieldErrors, toFormError, type FormState } from "@/lib/forms";

/**
 * Expenses (§9). Director only.
 *
 * §9 is explicit that this module is for **operating** expenses: manufacturing
 * cost is already captured as each product's cost price and flows into COGS.
 * The UI says so; nothing here can enforce what a human types, so the warning is
 * where the Director will read it.
 */

function revalidateExpenses(): void {
  revalidatePath("/expenses");
  revalidatePath("/expenses/categories");
  revalidatePath("/expenses/recurring");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
}

function readExpenseForm(formData: FormData) {
  return {
    expenseDate: String(formData.get("expenseDate") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
    amountCents: String(formData.get("amountCents") ?? ""),
    method: String(formData.get("method") ?? "CASH"),
    description: String(formData.get("description") ?? ""),
  };
}

export async function createExpenseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageExpenses);

    const parsed = expenseSchema.safeParse(readExpenseForm(formData));
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };

    // Optional receipt photo (§9.2).
    let receiptUrl: string | null = null;
    const file = formData.get("receipt");
    if (isFilled(file)) {
      if (file.size > MAX_IMAGE_BYTES) {
        return { fieldErrors: { receipt: "valid.imageSize" } };
      }
      const saved = await saveImage(file, "receipts");
      if (!saved.ok) {
        return {
          fieldErrors: {
            receipt: saved.error === "SIZE" ? "valid.imageSize" : "valid.imageType",
          },
        };
      }
      receiptUrl = saved.upload.url;
    }

    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(expenses)
        .values({ ...parsed.data, receiptImageUrl: receiptUrl, userId: actor.id })
        .returning({ id: expenses.id });
      await writeAudit(
        {
          userId: actor.id,
          entity: "expense",
          entityId: row.id,
          action: "create",
          label: parsed.data.description ?? parsed.data.expenseDate,
          newValue: parsed.data,
        },
        tx,
      );
    });

    revalidateExpenses();
    return { ok: true, message: "expense.created" };
  } catch (error) {
    return toFormError(error);
  }
}

export async function updateExpenseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageExpenses);
    const id = String(formData.get("id") ?? "");

    const parsed = expenseSchema.safeParse(readExpenseForm(formData));
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };

    const [before] = await db.select().from(expenses).where(eq(expenses.id, id));
    if (!before) return { error: "valid.notFound" };

    await db.transaction(async (tx) => {
      await tx.update(expenses).set(parsed.data).where(eq(expenses.id, id));
      const diff = diffFields(before, parsed.data, [
        "expenseDate",
        "categoryId",
        "amountCents",
        "method",
        "description",
      ]);
      if (diff) {
        await writeAudit(
          {
            userId: actor.id,
            entity: "expense",
            entityId: id,
            action: "update",
            label: parsed.data.description ?? parsed.data.expenseDate,
            oldValue: diff.old,
            newValue: diff.new,
          },
          tx,
        );
      }
    });

    revalidateExpenses();
    return { ok: true, message: "expense.updated" };
  } catch (error) {
    return toFormError(error);
  }
}

export async function deleteExpenseAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.manageExpenses);
  const id = String(formData.get("id") ?? "");

  const [before] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (!before) return;

  await db.transaction(async (tx) => {
    await tx.delete(expenses).where(eq(expenses.id, id));
    await writeAudit(
      {
        userId: actor.id,
        entity: "expense",
        entityId: id,
        action: "delete",
        label: before.description ?? before.expenseDate,
        oldValue: {
          expenseDate: before.expenseDate,
          amountCents: Number(before.amountCents),
        },
      },
      tx,
    );
  });

  // File last: a rolled-back delete must not leave a missing receipt behind.
  if (before.receiptImageUrl) await deleteUpload(before.receiptImageUrl);
  revalidateExpenses();
}

// ---------------------------------------------------------------------------
// Categories (§9.1)
// ---------------------------------------------------------------------------

export async function createExpenseCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageExpenses);
    const parsed = expenseCategorySchema.safeParse({
      name: String(formData.get("name") ?? ""),
      type: String(formData.get("type") ?? "VARIABLE"),
    });
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };

    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(expenseCategories)
        .values(parsed.data)
        .returning({ id: expenseCategories.id });
      await writeAudit(
        {
          userId: actor.id,
          entity: "expense_category",
          entityId: row.id,
          action: "create",
          label: `${parsed.data.name} (${parsed.data.type})`,
        },
        tx,
      );
    });

    revalidateExpenses();
    return { ok: true, message: "expcat.created" };
  } catch (error) {
    return toFormError(error);
  }
}

export async function updateExpenseCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageExpenses);
    const id = String(formData.get("id") ?? "");
    const parsed = expenseCategorySchema.safeParse({
      name: String(formData.get("name") ?? ""),
      type: String(formData.get("type") ?? "VARIABLE"),
    });
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };

    const [before] = await db
      .select()
      .from(expenseCategories)
      .where(eq(expenseCategories.id, id));
    if (!before) return { error: "valid.notFound" };

    await db.transaction(async (tx) => {
      await tx
        .update(expenseCategories)
        .set(parsed.data)
        .where(eq(expenseCategories.id, id));
      const diff = diffFields(before, parsed.data, ["name", "type"]);
      if (diff) {
        await writeAudit(
          {
            userId: actor.id,
            entity: "expense_category",
            entityId: id,
            action: "update",
            label: parsed.data.name,
            oldValue: diff.old,
            newValue: diff.new,
          },
          tx,
        );
      }
    });

    revalidateExpenses();
    return { ok: true, message: "expcat.updated" };
  } catch (error) {
    return toFormError(error);
  }
}

/** §9.1 allows archiving, not deleting — history must keep its category. */
export async function setExpenseCategoryActiveAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.manageExpenses);
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";

  const [before] = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.id, id));
  if (!before) return;

  await db.transaction(async (tx) => {
    await tx
      .update(expenseCategories)
      .set({ active })
      .where(eq(expenseCategories.id, id));
    await writeAudit(
      {
        userId: actor.id,
        entity: "expense_category",
        entityId: id,
        action: "update",
        label: before.name,
        oldValue: { active: before.active },
        newValue: { active },
      },
      tx,
    );
  });

  revalidateExpenses();
}

// ---------------------------------------------------------------------------
// Recurring templates (§9.3)
// ---------------------------------------------------------------------------

export async function createRecurringAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageExpenses);
    const parsed = recurringExpenseSchema.safeParse({
      categoryId: String(formData.get("categoryId") ?? ""),
      amountCents: String(formData.get("amountCents") ?? ""),
      method: String(formData.get("method") ?? "BANK"),
      description: String(formData.get("description") ?? ""),
    });
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };

    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(recurringExpenses)
        .values(parsed.data)
        .returning({ id: recurringExpenses.id });
      await writeAudit(
        {
          userId: actor.id,
          entity: "recurring_expense",
          entityId: row.id,
          action: "create",
          label: parsed.data.description ?? "",
          newValue: parsed.data,
        },
        tx,
      );
    });

    revalidateExpenses();
    return { ok: true, message: "recur.created" };
  } catch (error) {
    return toFormError(error);
  }
}

export async function deleteRecurringAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.manageExpenses);
  const id = String(formData.get("id") ?? "");

  const [before] = await db
    .select()
    .from(recurringExpenses)
    .where(eq(recurringExpenses.id, id));
  if (!before) return;

  await db.transaction(async (tx) => {
    await tx.delete(recurringExpenses).where(eq(recurringExpenses.id, id));
    await writeAudit(
      {
        userId: actor.id,
        entity: "recurring_expense",
        entityId: id,
        action: "delete",
        label: before.description ?? "",
        oldValue: { amountCents: Number(before.amountCents) },
      },
      tx,
    );
  });

  revalidateExpenses();
}

/**
 * §9.3: copy the active templates into the current month.
 *
 * Explicitly manual, and guarded against double-posting: if expenses matching
 * the templates already exist for that month, it refuses and says how many —
 * generating twice would silently double the month's fixed costs and wreck both
 * the P&L and the break-even figure.
 */
export async function generateRecurringAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { actor } = await authorize(can.manageExpenses);

    const monthInput = String(formData.get("month") ?? "").trim();
    const anchor = /^\d{4}-\d{2}$/.test(monthInput)
      ? `${monthInput}-01`
      : startOfMonth(today());
    const from = startOfMonth(anchor);
    const to = endOfMonth(anchor);

    const templates = await db
      .select()
      .from(recurringExpenses)
      .where(eq(recurringExpenses.active, true));

    if (templates.length === 0) return { error: "recur.noneActive" };

    // Already generated? Look for expenses in this month whose category and
    // amount match a template.
    const [existing] = await db
      .select({ n: sql<number>`count(*)` })
      .from(expenses)
      .where(
        and(
          sql`${expenses.expenseDate} BETWEEN ${from} AND ${to}`,
          sql`(${expenses.categoryId}, ${expenses.amountCents}) IN (${sql.join(
            templates.map((tpl) => sql`(${tpl.categoryId}, ${tpl.amountCents})`),
            sql`, `,
          )})`,
        ),
      );

    if (Number(existing?.n ?? 0) > 0) {
      return {
        error: msg("recur.alreadyGenerated", {
          month: monthKey(from),
          count: Number(existing.n),
        }),
      };
    }

    await db.transaction(async (tx) => {
      for (const tpl of templates) {
        await tx.insert(expenses).values({
          expenseDate: from,
          categoryId: tpl.categoryId,
          amountCents: tpl.amountCents,
          method: tpl.method,
          description: tpl.description,
          userId: actor.id,
        });
      }
      await writeAudit(
        {
          userId: actor.id,
          entity: "expense",
          action: "generate",
          label: monthKey(from),
          newValue: { month: monthKey(from), created: templates.length },
        },
        tx,
      );
    });

    revalidateExpenses();
    return {
      ok: true,
      message: msg("recur.generated", {
        count: templates.length,
        month: monthKey(from),
      }),
    };
  } catch (error) {
    return toFormError(error);
  }
}
