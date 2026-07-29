"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import {
  commitImportAction,
  uploadImportAction,
  type ImportPreviewState,
} from "./actions";
import { translateIssue } from "@/lib/forms";
import { useI18n } from "@/i18n/client";
import { formatMoney } from "@/i18n";
import type { TranslationKey } from "@/i18n";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Table,
  Td,
  Th,
} from "@/components/ui";

const EMPTY: ImportPreviewState = {};

/**
 * Upload → validate → preview → confirm (§14).
 *
 * The validated rows are held in this component and posted back on confirm, so
 * what the Director approves is exactly what gets written — there is no
 * server-side staging area that could drift between the two steps.
 */
export function ImportWizard() {
  const { t, locale } = useI18n();
  const [upload, uploadAction, uploading] = useActionState(uploadImportAction, EMPTY);
  const [commit, commitAction, committing] = useActionState(commitImportAction, EMPTY);

  // Once committed, the preview is stale — show the result instead.
  const done = commit.ok && commit.result;
  const rows = upload.rows ?? [];
  const problems = upload.problems ?? [];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("import.template")}</CardTitle>
          <Link href="/products/import/template" prefetch={false}>
            <Button variant="secondary" size="sm">
              {t("common.download")}
            </Button>
          </Link>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-muted">{t("import.openingStockHint")}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("import.upload")}</CardTitle>
        </CardHeader>
        <CardBody>
          <form action={uploadAction} className="space-y-4">
            {upload.error && (
              <Alert variant="error">{translateIssue(t, upload.error)}</Alert>
            )}
            <Field
              label={t("import.file")}
              htmlFor="file"
              required
              error={translateIssue(t, upload.fieldErrors?.file)}
            >
              <input
                id="file"
                name="file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                required
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
              />
            </Field>
            <Button type="submit" disabled={uploading}>
              {uploading ? t("common.loading") : t("import.upload")}
            </Button>
          </form>
        </CardBody>
      </Card>

      {done && (
        <Alert variant="success">
          {t("import.done", {
            created: commit.result!.created,
            updated: commit.result!.updated,
            stock: commit.result!.stock,
          })}
        </Alert>
      )}

      {commit.error && <Alert variant="error">{translateIssue(t, commit.error)}</Alert>}

      {!done && (rows.length > 0 || problems.length > 0) && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Badge color={rows.length > 0 ? "green" : "slate"}>
              {t("import.rowsValid", { count: rows.length })}
            </Badge>
            {problems.length > 0 && (
              <Badge color="red">
                {t("import.rowsInvalid", { count: problems.length })}
              </Badge>
            )}
          </div>

          {problems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("import.problem")}</CardTitle>
              </CardHeader>
              <Table>
                <thead>
                  <tr>
                    <Th numeric>{t("import.row")}</Th>
                    <Th>{t("product.sku")}</Th>
                    <Th>{t("common.type")}</Th>
                    <Th>{t("import.problem")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((p, i) => (
                    <tr key={`${p.rowNumber}-${i}`} className="bg-red-50/50">
                      <Td numeric>{p.rowNumber}</Td>
                      <Td className="font-mono text-xs">{p.sku}</Td>
                      <Td className="text-muted">{p.column ?? ""}</Td>
                      <Td>{t(p.messageKey as TranslationKey, p.params)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          {rows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("import.preview")}</CardTitle>
              </CardHeader>
              <Table>
                <thead>
                  <tr>
                    <Th numeric>{t("import.row")}</Th>
                    <Th>{t("product.sku")}</Th>
                    <Th>{t("common.name")}</Th>
                    <Th>{t("common.category")}</Th>
                    <Th numeric>{t("product.unitsPerBox")}</Th>
                    <Th numeric>{t("product.costPrice")}</Th>
                    <Th numeric>{t("product.marketPrice")}</Th>
                    <Th numeric>{t("product.exportPrice")}</Th>
                    <Th numeric>{t("import.openingStock")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r) => (
                    <tr key={r.rowNumber}>
                      <Td numeric className="text-muted">
                        {r.rowNumber}
                      </Td>
                      <Td className="font-mono text-xs">{r.sku}</Td>
                      <Td className="font-medium">{r.name}</Td>
                      <Td className="text-muted">
                        {r.categoryName ?? t("common.uncategorized")}
                      </Td>
                      <Td numeric>{r.unitsPerBox}</Td>
                      <Td numeric>{formatMoney(r.costPriceCents, locale)}</Td>
                      <Td numeric>{formatMoney(r.marketPriceCents, locale)}</Td>
                      <Td numeric>{formatMoney(r.exportPriceCents, locale)}</Td>
                      <Td numeric>{r.openingStock || ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {rows.length > 200 && (
                <p className="px-5 py-3 text-xs text-muted">
                  {t("import.rowsValid", { count: rows.length })}
                </p>
              )}
              <CardBody className="border-t border-border">
                <form action={commitAction}>
                  <input type="hidden" name="rows" value={JSON.stringify(rows)} />
                  <Button type="submit" disabled={committing}>
                    {committing
                      ? t("common.saving")
                      : t("import.confirm", { count: rows.length })}
                  </Button>
                </form>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
