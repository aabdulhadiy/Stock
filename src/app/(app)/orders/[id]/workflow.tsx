"use client";

import * as React from "react";
import {
  acceptOrderAction,
  cancelOrderAction,
  markReadyAction,
  reserveAvailableAction,
  shipOrderAction,
  togglePickedAction,
} from "../actions";
import { EMPTY_FORM_STATE, translateIssue, type FormState } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { useT } from "@/i18n/client";
import type { OrderStatus } from "@/db/schema";
import { Alert, Button, Card, CardBody, Input } from "@/components/ui";

/**
 * The order's action bar: exactly the transitions that are legal from the
 * current status (§5.3), and nothing else. The server re-checks every one of
 * them — this only decides what to offer.
 */
export function OrderWorkflow({
  orderId,
  status,
  fullyReserved,
  allPicked,
  shortfall,
  canFulfil,
  canCancel,
  today,
}: {
  orderId: string;
  status: OrderStatus;
  fullyReserved: boolean;
  allPicked: boolean;
  shortfall: number;
  canFulfil: boolean;
  canCancel: boolean;
  today: string;
}) {
  const t = useT();
  const [notice, setNotice] = React.useState<FormState>(EMPTY_FORM_STATE);

  const accept = useFormAction(acceptOrderAction, EMPTY_FORM_STATE, {
    resetOnSuccess: false,
    onSuccess: setNotice,
  });
  const topUp = useFormAction(reserveAvailableAction, EMPTY_FORM_STATE, {
    resetOnSuccess: false,
    onSuccess: setNotice,
  });
  const ready = useFormAction(markReadyAction, EMPTY_FORM_STATE, {
    resetOnSuccess: false,
    onSuccess: setNotice,
  });
  const ship = useFormAction(shipOrderAction, EMPTY_FORM_STATE, {
    resetOnSuccess: false,
    onSuccess: setNotice,
  });
  const cancel = useFormAction(cancelOrderAction, EMPTY_FORM_STATE, {
    resetOnSuccess: false,
    onSuccess: setNotice,
  });

  // Surface whichever action last reported a problem.
  const error =
    accept.state.error ??
    topUp.state.error ??
    ready.state.error ??
    ship.state.error ??
    cancel.state.error;

  const pending =
    accept.pending || topUp.pending || ready.pending || ship.pending || cancel.pending;

  if (status === "SHIPPED" || status === "CANCELLED") {
    return notice.message || error ? (
      <div className="space-y-3">
        {error && <Alert variant="error">{translateIssue(t, error)}</Alert>}
        {notice.message && (
          <Alert variant="success">{translateIssue(t, notice.message)}</Alert>
        )}
      </div>
    ) : null;
  }

  const hidden = <input type="hidden" name="id" value={orderId} />;

  return (
    <Card>
      <CardBody className="space-y-3">
        {error && <Alert variant="error">{translateIssue(t, error)}</Alert>}
        {notice.message && (
          <Alert variant="success">{translateIssue(t, notice.message)}</Alert>
        )}

        <div className="flex flex-wrap items-end gap-3">
          {/* NEW: the warehouse accepts, which is when stock gets reserved. */}
          {status === "NEW" && canFulfil && (
            <form onSubmit={accept.submit}>
              {hidden}
              <Button type="submit" disabled={pending}>
                {accept.pending ? t("common.saving") : t("order.accept")}
              </Button>
            </form>
          )}

          {/* PICKING / READY with a shortfall: explicit top-up (BR-5). */}
          {(status === "PICKING" || status === "READY") && canFulfil && shortfall > 0 && (
            <form onSubmit={topUp.submit}>
              {hidden}
              <Button type="submit" variant="secondary" disabled={pending}>
                {topUp.pending ? t("common.saving") : t("order.reserveAvailable")}
              </Button>
            </form>
          )}

          {status === "PICKING" && canFulfil && (
            <form onSubmit={ready.submit}>
              {hidden}
              <Button
                type="submit"
                variant="success"
                disabled={pending || !fullyReserved || !allPicked}
                title={
                  !fullyReserved
                    ? t("order.notFullyReserved")
                    : !allPicked
                      ? t("order.notAllPicked")
                      : undefined
                }
              >
                {ready.pending ? t("common.saving") : t("order.markReady")}
              </Button>
            </form>
          )}

          {status === "READY" && canFulfil && (
            <form onSubmit={ship.submit} className="flex items-end gap-2">
              {hidden}
              <div>
                <label
                  className="mb-1 block text-xs font-medium text-muted"
                  htmlFor="shipDate"
                >
                  {t("order.actualShipDate")}
                </label>
                <Input
                  id="shipDate"
                  name="shipDate"
                  type="date"
                  defaultValue={today}
                  required
                  className="h-9 py-1.5"
                />
              </div>
              <Button type="submit" disabled={pending}>
                {ship.pending ? t("common.saving") : t("order.ship")}
              </Button>
            </form>
          )}

          {canCancel && (
            <form
              onSubmit={(event) => {
                // Cancelling releases stock; make it a deliberate act.
                if (!window.confirm(t("order.cancelConfirm"))) {
                  event.preventDefault();
                  return;
                }
                cancel.submit(event);
              }}
              className="ml-auto"
            >
              {hidden}
              <Button type="submit" variant="danger" disabled={pending}>
                {cancel.pending ? t("common.saving") : t("order.cancel")}
              </Button>
            </form>
          )}
        </div>

        {status === "NEW" && (
          <p className="text-xs text-muted">{t("order.noReservationYet")}</p>
        )}
        {shortfall > 0 && status !== "NEW" && (
          <p className="text-xs text-amber-700">
            {t("produce.shortTotal")}: {shortfall}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/** Per-line picked tick (§7.2). */
export function PickedToggle({
  lineId,
  orderId,
  picked,
}: {
  lineId: string;
  orderId: string;
  picked: boolean;
}) {
  const t = useT();
  return (
    <form action={togglePickedAction}>
      <input type="hidden" name="lineId" value={lineId} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="picked" value={picked ? "false" : "true"} />
      <button
        type="submit"
        className={
          picked
            ? "text-xs font-medium text-emerald-700 hover:underline"
            : "text-xs text-muted hover:underline"
        }
      >
        {picked ? `✓ ${t("pick.pickedFlag")}` : t("pick.markPicked")}
      </button>
    </form>
  );
}
