import "server-only";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  expenseCategories,
  expenses,
  recurringExpenses,
  users,
  type ExpenseType,
  type PaymentMethod,
} from "@/db/schema";

/** Expense read models (§9). Director-only data; guarded at every entry point. */

export interface ExpenseRow {
  id: string;
  expenseDate: string;
  categoryId: string;
  categoryName: string;
  categoryType: ExpenseType;
  amountCents: number;
  method: PaymentMethod;
  description: string | null;
  receiptImageUrl: string | null;
  enteredBy: string | null;
  createdAt: Date;
}

export async function listExpenses(
  options: { from?: string; to?: string; categoryId?: string | null } = {},
  exec: Executor = db,
): Promise<ExpenseRow[]> {
  const conditions = [];
  if (options.from) conditions.push(gte(expenses.expenseDate, options.from));
  if (options.to) conditions.push(lte(expenses.expenseDate, options.to));
  if (options.categoryId) conditions.push(eq(expenses.categoryId, options.categoryId));

  const rows = await exec
    .select({
      id: expenses.id,
      expenseDate: expenses.expenseDate,
      categoryId: expenses.categoryId,
      categoryName: expenseCategories.name,
      categoryType: expenseCategories.type,
      amountCents: expenses.amountCents,
      method: expenses.method,
      description: expenses.description,
      receiptImageUrl: expenses.receiptImageUrl,
      enteredBy: users.name,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(users, eq(users.id, expenses.userId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
    .limit(1000);

  return rows.map((r) => ({ ...r, amountCents: Number(r.amountCents) }));
}

export async function listExpenseCategories(
  opts: { includeArchived?: boolean } = {},
  exec: Executor = db,
): Promise<
  {
    id: string;
    name: string;
    type: ExpenseType;
    active: boolean;
    expenseCount: number;
  }[]
> {
  const rows = await exec
    .select({
      id: expenseCategories.id,
      name: expenseCategories.name,
      type: expenseCategories.type,
      active: expenseCategories.active,
      expenseCount: sql<number>`(
        SELECT COUNT(*) FROM expenses e WHERE e.category_id = ${sql`"expense_categories"."id"`}
      )`,
    })
    .from(expenseCategories)
    .where(opts.includeArchived ? undefined : eq(expenseCategories.active, true))
    .orderBy(asc(expenseCategories.type), asc(expenseCategories.name));

  return rows.map((r) => ({ ...r, expenseCount: Number(r.expenseCount) }));
}

export async function listRecurringExpenses(
  exec: Executor = db,
): Promise<
  {
    id: string;
    categoryId: string;
    categoryName: string;
    categoryType: ExpenseType;
    amountCents: number;
    method: PaymentMethod;
    description: string | null;
    active: boolean;
  }[]
> {
  const rows = await exec
    .select({
      id: recurringExpenses.id,
      categoryId: recurringExpenses.categoryId,
      categoryName: expenseCategories.name,
      categoryType: expenseCategories.type,
      amountCents: recurringExpenses.amountCents,
      method: recurringExpenses.method,
      description: recurringExpenses.description,
      active: recurringExpenses.active,
    })
    .from(recurringExpenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, recurringExpenses.categoryId))
    .orderBy(asc(expenseCategories.name));

  return rows.map((r) => ({ ...r, amountCents: Number(r.amountCents) }));
}

export async function getExpense(id: string, exec: Executor = db) {
  const [row] = await exec.select().from(expenses).where(eq(expenses.id, id));
  return row ?? null;
}
