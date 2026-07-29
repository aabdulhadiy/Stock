"use client";

import {
  approveCountAction,
  cancelCountAction,
  createCountAction,
  saveCountAction,
  submitCountAction,
} from "./actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useFormAction } from "@/lib/use-form-action";
import { useT } from "@/i18n/client";
import type { CountStatus } from "@/db/schema";
import {
  Alert,
  Button,
  CardBody,
  Field,
  Hint,
  Input,
  Table,
  Td,
  Th,
} from "@/components/ui";

export function NewCountForm({ today }: { today: string }) {
  const t = useT();
  const { state, pending, submit } = useFormAction(createCountAction, EMPTY_FORM_STATE, {
    resetOnSuccess: false,
  });

  return (
    <CardBody>
      <form onSubmit={submit} className="space-y-3">
        {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}

        <Field
          label={t("count.date")}
          htmlFor="countDate"
          required
          error={translateIssue(t, state.fieldErrors?.countDate)}
        >
          <Input id="countDate" name="countDate" type="date" defaultValue={today} required />
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="prefill"
            value="1"
            defaultChecked
            className="mt-0.5 size-4 rounded border-border"
          />
          <span>
            {t("count.addAllProducts")}
            <Hint>{t("count.systemQty")}</Hint>
          </span>
        </label>

        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("common.saving") : t("common.create")}
        </Button>
      </form>
    </CardBody>
  );
}

export interface CountLine {
  id: string;
  productId: string;
  sku: string;
  name: string;
  countedQty: number;
  systemQty: number;
  variance: number;
}

/**
 * The count sheet. Editable while DRAFT; read-only afterwards, because a
 * submitted sheet is what the Director is being asked to approve.
 */
export function CountSheet({
  countId,
  status,
  lines,
  canApprove,
}: {
  countId: string;
  status: CountStatus;
  lines: CountLine[];
  canApprove: boolean;
}) {
  const t = useT();
  const save = useFormAction(saveCountAction, EMPTY_FORM_STATE, { resetOnSuccess: false });
  const submitForApproval = useFormAction(submitCountAction, EMPTY_FORM_STATE, {
    resetOnSuccess: false,
  });
  const approve = useFormAction(approveCountAction, EMPTY_FORM_STATE, {
    resetOnSuccess: false,
  });
  const cancel = useFormAction(cancelCountAction, EMPTY_FORM_STATE, {
    resetOnSuccess: false,
  });

  const editable = status === "DRAFT";
  const notice =
    save.state.message ??
    submitForApproval.state.message ??
    approve.state.message ??
    cancel.state.message;
  const error =
    save.state.error ??
    submitForApproval.state.error ??
    approve.state.error ??
    cancel.state.error;

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{translateIssue(t, error)}</Alert>}
      {notice && <Alert variant="success">{translateIssue(t, notice)}</Alert>}

      <form onSubmit={save.submit}>
        <input type="hidden" name="id" value={countId} />

        <Table>
          <thead>
            <tr>
              <Th>{t("product.sku")}</Th>
              <Th>{t("common.product")}</Th>
              <Th numeric>{t("count.systemQty")}</Th>
              <Th numeric>{t("count.countedQty")}</Th>
              <Th numeric>{t("count.variance")}</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr
                key={line.id}
                className={line.variance !== 0 ? "bg-amber-50/60" : undefined}
              >
                <Td className="font-mono text-xs">{line.sku}</Td>
                <Td className="font-medium">{line.name}</Td>
                <Td numeric className="text-muted">
                  {line.systemQty}
                </Td>
                <Td numeric className="w-28">
                  {editable ? (
                    <>
                      <input type="hidden" name="itemId" value={line.id} />
                      <Input
                        name="countedQty"
                        inputMode="numeric"
                        defaultValue={line.countedQty}
                        className="h-8 py-1 text-right text-sm"
                      />
                    </>
                  ) : (
                    line.countedQty
                  )}
                </Td>
                <Td
                  numeric
                  className={
                    line.variance === 0
                      ? "text-muted"
                      : line.variance > 0
                        ? "font-semibold text-emerald-700"
                        : "font-semibold text-red-600"
                  }
                >
                  {line.variance > 0 ? `+${line.variance}` : line.variance || "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>

        {editable && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border p-5">
            <Button type="submit" variant="secondary" disabled={save.pending}>
              {save.pending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-3">
        {status === "DRAFT" && (
          <form onSubmit={submitForApproval.submit}>
            <input type="hidden" name="id" value={countId} />
            <Button type="submit" disabled={submitForApproval.pending || lines.length === 0}>
              {submitForApproval.pending ? t("common.saving") : t("count.submit")}
            </Button>
          </form>
        )}

        {status === "SUBMITTED" && canApprove && (
          <form
            onSubmit={(event) => {
              // Approving moves real stock; make it deliberate.
              if (!window.confirm(t("count.approve"))) {
                event.preventDefault();
                return;
              }
              approve.submit(event);
            }}
          >
            <input type="hidden" name="id" value={countId} />
            <Button type="submit" variant="success" disabled={approve.pending}>
              {approve.pending ? t("common.saving") : t("count.approve")}
            </Button>
          </form>
        )}

        {status !== "APPROVED" && status !== "CANCELLED" && (
          <form onSubmit={cancel.submit} className="ml-auto">
            <input type="hidden" name="id" value={countId} />
            <Button type="submit" variant="danger" disabled={cancel.pending}>
              {t("count.rejectCount")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
