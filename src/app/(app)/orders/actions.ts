"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { authorize, getCurrentUser } from "@/lib/auth";
import { can, type Actor } from "@/lib/permissions";
import { InsufficientStockError } from "@/lib/stock";
import {
  acceptOrder,
  ArchivedProductError,
  cancelOrder,
  createOrder,
  markOrderReady,
  OrderStateError,
  reserveAvailableForOrder,
  setLinePicked,
  shipOrder,
  updateOrder,
  type OrderLineInput,
} from "@/lib/orders";
import {
  orderHeaderSchema,
  ENTERED_AS,
  requiredDate,
} from "@/lib/validation";
import { parseMoneyToCents } from "@/lib/money";
import { zodToFieldErrors, toFormError, type FormState } from "@/lib/forms";

/**
 * Order mutations (§5, §6, §7).
 *
 * Authorization runs here for every action; the §5.3 status rules and all
 * reservation movement live in `lib/orders.ts`, so these functions only parse
 * input, delegate, and translate domain errors into form messages.
 */

export interface OrderFormState extends FormState {
  orderId?: string;
  orderNumber?: string;
}

/** Turn a domain error into a translated form message. */
function mapDomainError(error: unknown): FormState | null {
  if (error instanceof ArchivedProductError) {
    return { error: "order.archivedProduct" };
  }
  if (error instanceof OrderStateError) {
    switch (error.reason) {
      case "NOT_FULLY_RESERVED":
        return { error: "order.notFullyReserved" };
      case "NOT_ALL_PICKED":
        return { error: "order.notAllPicked" };
      case "NO_LINES":
        return { error: "order.noLines" };
      default:
        return { error: "order.editBlocked" };
    }
  }
  if (error instanceof InsufficientStockError) {
    return { error: "order.reserveNothing" };
  }
  return null;
}

/** Parse the repeatable line rows out of the form. */
function readLines(formData: FormData): OrderLineInput[] | "INVALID" {
  const productIds = formData.getAll("productId").map(String);
  const quantities = formData.getAll("qty").map(String);
  const bases = formData.getAll("enteredAs").map(String);
  const prices = formData.getAll("unitPrice").map(String);

  const lines: OrderLineInput[] = [];
  for (let i = 0; i < productIds.length; i++) {
    const productId = productIds[i];
    const qtyRaw = (quantities[i] ?? "").trim();
    // Blank rows are expected — the form always offers a spare one.
    if (!productId || qtyRaw === "") continue;

    const qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty <= 0) return "INVALID";

    const cents = parseMoneyToCents(prices[i] ?? "");
    if (cents === null || cents < 0) return "INVALID";

    const enteredAs = (ENTERED_AS as readonly string[]).includes(bases[i] ?? "")
      ? (bases[i] as OrderLineInput["enteredAs"])
      : "UNITS";

    lines.push({ productId, qty, enteredAs, unitPriceCents: cents });
  }
  return lines;
}

function readHeader(formData: FormData) {
  return {
    customerId: String(formData.get("customerId") ?? ""),
    priceType: String(formData.get("priceType") ?? "MARKET"),
    plannedShipDate: String(formData.get("plannedShipDate") ?? ""),
    paymentMethod: String(formData.get("paymentMethod") ?? "CASH"),
    paymentTermDays: String(formData.get("paymentTermDays") ?? "0"),
    note: String(formData.get("note") ?? ""),
  };
}

export async function createOrderAction(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  let created: { orderId: string; number: string };
  try {
    const { actor } = await authorize(can.createOrder);

    const parsed = orderHeaderSchema.safeParse(readHeader(formData));
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };

    const lines = readLines(formData);
    if (lines === "INVALID") return { error: "valid.positive" };
    if (lines.length === 0) return { error: "order.noLines" };

    created = await createOrder(actor.id, parsed.data, lines);
  } catch (error) {
    return mapDomainError(error) ?? toFormError(error);
  }

  revalidatePath("/orders");
  revalidatePath("/queue");
  revalidatePath("/dashboard");
  // Outside the try: redirect signals control flow by throwing.
  redirect(`/orders/${created.orderId}`);
}

export async function updateOrderAction(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const orderId = String(formData.get("id") ?? "");
  try {
    const user = await getCurrentUser();
    if (!user) return { error: "auth.noAccess" };
    const actor: Actor = { id: user.sub, role: user.role };

    const [order] = await db
      .select({ createdById: orders.createdById })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) return { error: "valid.notFound" };
    if (!can.editOrder(actor, order)) return { error: "auth.noAccess" };

    const parsed = orderHeaderSchema.safeParse(readHeader(formData));
    if (!parsed.success) return { fieldErrors: zodToFieldErrors(parsed.error) };

    const lineIds = formData.getAll("lineId").map(String);
    const raw = readLines(formData);
    if (raw === "INVALID") return { error: "valid.positive" };
    if (raw.length === 0) return { error: "order.noLines" };

    // readLines skips blank rows, so re-align ids by walking the same filter.
    const productIds = formData.getAll("productId").map(String);
    const quantities = formData.getAll("qty").map(String);
    const keptIndexes: number[] = [];
    for (let i = 0; i < productIds.length; i++) {
      if (productIds[i] && (quantities[i] ?? "").trim() !== "") keptIndexes.push(i);
    }
    const lines = raw.map((line, n) => {
      const id = lineIds[keptIndexes[n]];
      return id ? { ...line, id } : line;
    });

    await updateOrder(actor.id, orderId, parsed.data, lines);
  } catch (error) {
    return mapDomainError(error) ?? toFormError(error);
  }

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/queue");
  revalidatePath("/produce");
  revalidatePath("/stock");
  redirect(`/orders/${orderId}`);
}

// ---------------------------------------------------------------------------
// Warehouse transitions
// ---------------------------------------------------------------------------

/** Revalidate every screen a reservation change is visible on. */
function revalidateFulfilment(orderId: string): void {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/queue");
  revalidatePath("/produce");
  revalidatePath("/stock");
  revalidatePath("/dashboard");
}

export async function acceptOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = String(formData.get("id") ?? "");
  try {
    const { actor } = await authorize(can.fulfilOrder);
    const outcomes = await acceptOrder(actor.id, orderId);
    revalidateFulfilment(orderId);

    const short = outcomes.reduce((s, o) => s + o.shortfall, 0);
    return {
      ok: true,
      // A shortfall is not a failure — it is a production requirement (§7.3).
      message: short > 0 ? "order.accepted" : "order.accepted",
    };
  } catch (error) {
    return mapDomainError(error) ?? toFormError(error);
  }
}

export async function reserveAvailableAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = String(formData.get("id") ?? "");
  try {
    const { actor } = await authorize(can.fulfilOrder);
    const { gained } = await reserveAvailableForOrder(actor.id, orderId);
    revalidateFulfilment(orderId);
    return gained > 0
      ? { ok: true, message: "order.reserveTopUp" }
      : { error: "order.reserveNothing" };
  } catch (error) {
    return mapDomainError(error) ?? toFormError(error);
  }
}

export async function togglePickedAction(formData: FormData): Promise<void> {
  const { actor } = await authorize(can.fulfilOrder);
  const lineId = String(formData.get("lineId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");
  const picked = formData.get("picked") === "true";
  try {
    await setLinePicked(actor.id, lineId, picked);
  } catch {
    // A status change under the user's feet is not worth a crash; the page
    // re-renders and shows the real state.
  }
  revalidatePath(`/orders/${orderId}`);
}

export async function markReadyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = String(formData.get("id") ?? "");
  try {
    const { actor } = await authorize(can.fulfilOrder);
    await markOrderReady(actor.id, orderId);
    revalidateFulfilment(orderId);
    return { ok: true, message: "order.markedReady" };
  } catch (error) {
    return mapDomainError(error) ?? toFormError(error);
  }
}

export async function shipOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = String(formData.get("id") ?? "");
  try {
    const { actor } = await authorize(can.fulfilOrder);

    const dateParsed = requiredDate().safeParse(String(formData.get("shipDate") ?? ""));
    if (!dateParsed.success) {
      return { fieldErrors: { shipDate: dateParsed.error.issues[0].message } };
    }

    await shipOrder(actor.id, orderId, dateParsed.data);
    revalidateFulfilment(orderId);
    revalidatePath("/receivables");
    return { ok: true, message: "order.shipped" };
  } catch (error) {
    return mapDomainError(error) ?? toFormError(error);
  }
}

export async function cancelOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orderId = String(formData.get("id") ?? "");
  try {
    const user = await getCurrentUser();
    if (!user) return { error: "auth.noAccess" };
    const actor: Actor = { id: user.sub, role: user.role };

    const [order] = await db
      .select({ createdById: orders.createdById })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) return { error: "valid.notFound" };
    if (!can.cancelOrder(actor, order)) return { error: "auth.noAccess" };

    await cancelOrder(actor.id, orderId);
    revalidateFulfilment(orderId);
    return { ok: true, message: "order.cancelled" };
  } catch (error) {
    return mapDomainError(error) ?? toFormError(error);
  }
}
