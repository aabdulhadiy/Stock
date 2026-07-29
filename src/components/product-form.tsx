"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  createProductAction,
  updateProductAction,
} from "@/app/(app)/products/actions";
import { EMPTY_FORM_STATE, translateIssue } from "@/lib/forms";
import { useT } from "@/i18n/client";
import { centsToInput } from "@/lib/money";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Hint,
  Input,
  Select,
} from "@/components/ui";

export interface ProductFormValues {
  id?: string;
  sku: string;
  name: string;
  categoryId: string | null;
  unitsPerBox: number | string;
  unitsPerBag: number | string | null;
  boxVolumeM3: string;
  bagVolumeM3: string | null;
  weightKg: string;
  weightBasis: "UNIT" | "BOX";
  dimLengthCm: string;
  dimWidthCm: string;
  dimHeightCm: string;
  dimsBasis: "UNIT" | "BOX";
  costPriceCents?: number;
  marketPriceCents?: number;
  exportPriceCents?: number;
  status: "ACTIVE" | "ARCHIVED";
  minStock: number | null;
}

/** Trim trailing zeros so "0.050000" shows as "0.05" in the input. */
function tidy(value: string | null | undefined): string {
  if (!value) return "";
  return String(Number(value));
}

export function ProductForm({
  mode,
  values,
  categories,
}: {
  mode: "create" | "edit";
  values?: ProductFormValues;
  categories: { id: string; name: string }[];
}) {
  const t = useT();
  const [state, action, pending] = useActionState(
    mode === "create" ? createProductAction : updateProductAction,
    EMPTY_FORM_STATE,
  );

  const err = (field: string) => translateIssue(t, state.fieldErrors?.[field]);
  const v = values;

  return (
    <form action={action} className="space-y-5">
      {v?.id && <input type="hidden" name="id" value={v.id} />}

      {state.error && <Alert variant="error">{translateIssue(t, state.error)}</Alert>}
      {state.ok && state.message && (
        <Alert variant="success">{translateIssue(t, state.message)}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("product.card")}</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t("product.sku")} htmlFor="sku" required error={err("sku")}>
            <Input id="sku" name="sku" defaultValue={v?.sku} required className="font-mono" />
          </Field>
          <Field label={t("product.name")} htmlFor="name" required error={err("name")}>
            <Input id="name" name="name" defaultValue={v?.name} required />
          </Field>
          <Field label={t("product.category")} htmlFor="categoryId" error={err("categoryId")}>
            <Select id="categoryId" name="categoryId" defaultValue={v?.categoryId ?? ""}>
              <option value="">{t("common.uncategorized")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("product.status")} htmlFor="status" required error={err("status")}>
            <Select id="status" name="status" defaultValue={v?.status ?? "ACTIVE"}>
              <option value="ACTIVE">{t("product.status.ACTIVE")}</option>
              <option value="ARCHIVED">{t("product.status.ARCHIVED")}</option>
            </Select>
            <Hint>{t("product.archivedHint")}</Hint>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("product.pricing")}</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field
            label={t("product.costPrice")}
            htmlFor="costPriceCents"
            required
            error={err("costPriceCents")}
          >
            <Input
              id="costPriceCents"
              name="costPriceCents"
              inputMode="decimal"
              defaultValue={centsToInput(v?.costPriceCents)}
              required
            />
          </Field>
          <Field
            label={t("product.marketPrice")}
            htmlFor="marketPriceCents"
            required
            error={err("marketPriceCents")}
          >
            <Input
              id="marketPriceCents"
              name="marketPriceCents"
              inputMode="decimal"
              defaultValue={centsToInput(v?.marketPriceCents)}
              required
            />
          </Field>
          <Field
            label={t("product.exportPrice")}
            htmlFor="exportPriceCents"
            required
            error={err("exportPriceCents")}
          >
            <Input
              id="exportPriceCents"
              name="exportPriceCents"
              inputMode="decimal"
              defaultValue={centsToInput(v?.exportPriceCents)}
              required
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("product.packing")}</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label={t("product.unitsPerBox")}
            htmlFor="unitsPerBox"
            required
            error={err("unitsPerBox")}
          >
            <Input
              id="unitsPerBox"
              name="unitsPerBox"
              inputMode="numeric"
              defaultValue={v?.unitsPerBox ?? ""}
              required
            />
          </Field>
          <Field
            label={t("product.unitsPerBag")}
            htmlFor="unitsPerBag"
            error={err("unitsPerBag")}
          >
            <Input
              id="unitsPerBag"
              name="unitsPerBag"
              inputMode="numeric"
              defaultValue={v?.unitsPerBag ?? ""}
            />
          </Field>
          <Field
            label={t("product.minStock")}
            htmlFor="minStock"
            error={err("minStock")}
            hint={t("product.minStockHint")}
          >
            <Input
              id="minStock"
              name="minStock"
              inputMode="numeric"
              defaultValue={v?.minStock ?? ""}
            />
          </Field>

          <Field
            label={t("product.boxVolume")}
            htmlFor="boxVolumeM3"
            required
            error={err("boxVolumeM3")}
          >
            <Input
              id="boxVolumeM3"
              name="boxVolumeM3"
              inputMode="decimal"
              defaultValue={tidy(v?.boxVolumeM3)}
              required
            />
          </Field>
          <Field
            label={t("product.bagVolume")}
            htmlFor="bagVolumeM3"
            error={err("bagVolumeM3")}
          >
            <Input
              id="bagVolumeM3"
              name="bagVolumeM3"
              inputMode="decimal"
              defaultValue={tidy(v?.bagVolumeM3)}
            />
          </Field>
          <div />

          <Field
            label={t("product.weight")}
            htmlFor="weightKg"
            required
            error={err("weightKg")}
          >
            <Input
              id="weightKg"
              name="weightKg"
              inputMode="decimal"
              defaultValue={tidy(v?.weightKg)}
              required
            />
          </Field>
          <Field
            label={t("product.weightBasis")}
            htmlFor="weightBasis"
            required
            error={err("weightBasis")}
          >
            <Select id="weightBasis" name="weightBasis" defaultValue={v?.weightBasis ?? "BOX"}>
              <option value="UNIT">{t("product.basis.UNIT")}</option>
              <option value="BOX">{t("product.basis.BOX")}</option>
            </Select>
          </Field>
          <div />

          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">
              {t("product.dims")}
              <span className="text-red-600 ml-0.5">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <Input
                name="dimLengthCm"
                inputMode="decimal"
                aria-label={t("product.dimLength")}
                placeholder={t("product.dimLength")}
                defaultValue={tidy(v?.dimLengthCm)}
                required
              />
              <Input
                name="dimWidthCm"
                inputMode="decimal"
                aria-label={t("product.dimWidth")}
                placeholder={t("product.dimWidth")}
                defaultValue={tidy(v?.dimWidthCm)}
                required
              />
              <Input
                name="dimHeightCm"
                inputMode="decimal"
                aria-label={t("product.dimHeight")}
                placeholder={t("product.dimHeight")}
                defaultValue={tidy(v?.dimHeightCm)}
                required
              />
            </div>
            {(err("dimLengthCm") || err("dimWidthCm") || err("dimHeightCm")) && (
              <p className="text-xs text-red-600 mt-1" role="alert">
                {err("dimLengthCm") || err("dimWidthCm") || err("dimHeightCm")}
              </p>
            )}
          </div>
          <Field
            label={t("product.dimsBasis")}
            htmlFor="dimsBasis"
            required
            error={err("dimsBasis")}
          >
            <Select id="dimsBasis" name="dimsBasis" defaultValue={v?.dimsBasis ?? "BOX"}>
              <option value="UNIT">{t("product.basis.UNIT")}</option>
              <option value="BOX">{t("product.basis.BOX")}</option>
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("product.images")}</CardTitle>
        </CardHeader>
        <CardBody>
          <Field label={t("common.upload")} htmlFor="images" error={err("images")}>
            <input
              id="images"
              name="images"
              type="file"
              accept="image/jpeg,image/png"
              multiple
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
            />
            <Hint>{t("product.imagesHint")}</Hint>
          </Field>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
        <Link
          href={v?.id ? `/products/${v.id}` : "/products"}
          className="text-sm text-muted hover:underline"
        >
          {t("common.cancel")}
        </Link>
      </div>
    </form>
  );
}
