"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { exchangeRateSchema } from "@/lib/validation";
import { zodToFieldErrors, type FormState } from "@/lib/forms";

export async function setExchangeRate(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireRole("ADMIN");
  const parsed = exchangeRateSchema.safeParse({ rate: formData.get("rate") });
  if (!parsed.success) {
    return { error: "Please fix the errors below", fieldErrors: zodToFieldErrors(parsed.error) };
  }

  // Append a new effective rate; history is never deleted so past sales stay accurate.
  await db.insert(exchangeRates).values({
    rate: parsed.data.rate.toString(),
    setById: admin.sub,
  });

  revalidatePath("/admin/exchange-rate");
  return { ok: true };
}
