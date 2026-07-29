"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PaymentError, deletePayment, recordPayment } from "@/lib/payments";
import { createReturn, ReturnError } from "@/lib/returns";
import { paymentSchema, requiredDate, optionalText } from "@/lib/validation";
import { formatMoney } from "@/i18n";
import { msg, zodToFieldErrors, toFormError, type FormState } from "@/lib/forms";

/** Payments (§5.4) and returns (§11). Director only. */

function revalidateMoney(orderId?: string): void {
  if (orderId) {
    revalidatePath(`/orders/${orderId}`);
    revalidatePath(`/orders/${orderId}/payments`);
  }
  revalidatePath("/orders");
  revalidatePath("/receivables");
  revalidatePath("/customers");
  revalidatePath("/dashboard");
  revalidatePath("/reports");
}

export async function recordPaymentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = String(formData.get("orderId") ?? "");
  try {
    const { actor } = await authorize(can.managePayments);

    const parsed = paymentSchema.safeParse({
      orderId,
      paidOn: String(formData.get("paidOn") ?? ""),
      amountCents: String(formData.get("amountCents") ?? ""),
      method: String(formData.get("method") ?? "CASH"),
      note: String(formData.get("note") ?? ""),
    });
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };

    await recordPayment(actor.id, parsed.data);
    revalidateMoney(orderId);
    return { ok: true, message: "payment.recorded" };
  } catch (error) {
    if (error instanceof PaymentError) {
      switch (error.reason) {
        case "NOT_SHIPPED":
          return { error: "payment.notShipped" };
        case "EXCEEDS_BALANCE":
          return {
            fieldErrors: {
              amountCents: msg("payment.exceedsBalance", {
                balance: formatMoney(error.balanceCents),
              }),
            },
          };
        default:
          return { error: "valid.notFound" };
      }
    }
    return toFormError(error);
  }
}

export async function deletePaymentAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.managePayments);
  const paymentId = String(formData.get("paymentId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");
  try {
    await deletePayment(actor.id, paymentId);
  } catch {
    // Already gone is the desired end state.
  }
  revalidateMoney(orderId);
}

export async function createReturnAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = String(formData.get("orderId") ?? "");
  try {
    const { actor } = await authorize(can.manageReturns);

    const dateParsed = requiredDate().safeParse(String(formData.get("returnDate") ?? ""));
    if (!dateParsed.success) {
      return { fieldErrors: { returnDate: dateParsed.error.issues[0].message } };
    }
    const noteParsed = optionalText(1000).safeParse(String(formData.get("note") ?? ""));

    const itemIds = formData.getAll("orderItemId").map(String);
    const quantities = formData.getAll("qty").map(String);

    const lines = itemIds
      .map((orderItemId, i) => ({
        orderItemId,
        qtyUnits: Number((quantities[i] ?? "").trim() || 0),
      }))
      .filter((l) => l.orderItemId && l.qtyUnits > 0);

    if (lines.length === 0) return { error: "return.noLines" };
    if (lines.some((l) => !Number.isInteger(l.qtyUnits))) {
      return { error: "valid.integer" };
    }

    await createReturn(actor.id, {
      orderId,
      returnDate: dateParsed.data,
      note: noteParsed.success ? noteParsed.data : null,
      lines,
    });

    revalidateMoney(orderId);
    revalidatePath("/returns");
    revalidatePath("/stock");
    return { ok: true, message: "return.created" };
  } catch (error) {
    if (error instanceof ReturnError) {
      switch (error.reason) {
        case "NOT_SHIPPED":
          return { error: "return.noShippedOrders" };
        case "EXCEEDS_SHIPPED":
          return { error: "return.maxQty" };
        case "NO_LINES":
          return { error: "return.noLines" };
        default:
          return { error: "valid.notFound" };
      }
    }
    return toFormError(error);
  }
}
