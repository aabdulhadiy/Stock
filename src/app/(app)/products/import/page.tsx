"use client";

import { useActionState } from "react";
import Link from "next/link";
import { previewImport, commitImport, type ImportState } from "./actions";
import { Button, Card, CardBody, Alert, Table, Th, Td, Badge } from "@/components/ui";

const initial: ImportState = { phase: "idle" };

export default function ImportPage() {
  const [preview, previewAction, previewing] = useActionState(previewImport, initial);
  const [commit, commitAction, committing] = useActionState(commitImport, initial);

  // The commit result takes over once it has run.
  const done = commit.phase === "done";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Bulk product import</h1>
        <p className="text-muted text-sm mt-1">
          Upload an .xlsx file to add many products at once.
        </p>
      </div>

      {done ? (
        <Alert variant="success">
          {commit.createdCount} product{commit.createdCount === 1 ? "" : "s"} imported successfully.{" "}
          <Link href="/products" className="font-medium underline">
            View products
          </Link>
        </Alert>
      ) : (
        <>
          <Card>
            <CardBody className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Step 1 — Download the template</p>
                  <p className="text-sm text-muted">
                    Columns: name, sku, type (National/China), suggested_price, cost_price, units_per_box.
                  </p>
                </div>
                <a href="/products/import/template">
                  <Button variant="secondary">Download template</Button>
                </a>
              </div>

              <hr className="border-border" />

              <form action={previewAction} className="space-y-3">
                <p className="font-medium">Step 2 — Upload your filled-in file</p>
                {preview.error && <Alert variant="error">{preview.error}</Alert>}
                <input
                  type="file"
                  name="file"
                  accept=".xlsx"
                  required
                  className="block text-sm"
                />
                <Button type="submit" disabled={previewing}>
                  {previewing ? "Validating…" : "Validate & preview"}
                </Button>
              </form>
            </CardBody>
          </Card>

          {preview.phase === "preview" && preview.preview && (
            <Card>
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h3 className="text-base font-semibold">Preview</h3>
                <div className="flex gap-2">
                  <Badge color="green">{preview.preview.validCount} will be created</Badge>
                  {preview.preview.errorCount > 0 && (
                    <Badge color="red">{preview.preview.errorCount} with errors</Badge>
                  )}
                </div>
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th>Row</Th>
                    <Th>Name</Th>
                    <Th>SKU</Th>
                    <Th>Type</Th>
                    <Th className="text-right">Price</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.rows.map((r) => (
                    <tr key={r.rowNumber} className={r.errors.length ? "bg-red-50/50" : undefined}>
                      <Td className="text-muted">{r.rowNumber}</Td>
                      <Td className="font-medium">{r.name || "—"}</Td>
                      <Td className="text-muted">{r.sku ?? "—"}</Td>
                      <Td>{r.type ?? "—"}</Td>
                      <Td className="text-right tabular-nums">
                        {r.suggestedPriceUzs?.toLocaleString() ?? "—"}
                      </Td>
                      <Td>
                        {r.errors.length === 0 ? (
                          <Badge color="green">OK</Badge>
                        ) : (
                          <span className="text-xs text-red-600">{r.errors.join("; ")}</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <CardBody className="flex items-center gap-3 border-t border-border">
                <form action={commitAction}>
                  <input type="hidden" name="rawRows" value={preview.rawRows} />
                  <Button type="submit" disabled={committing || preview.preview.validCount === 0}>
                    {committing
                      ? "Importing…"
                      : `Confirm & import ${preview.preview.validCount} product${preview.preview.validCount === 1 ? "" : "s"}`}
                  </Button>
                </form>
                <Link href="/products">
                  <Button variant="secondary" type="button">
                    Cancel
                  </Button>
                </Link>
                {commit.error && <span className="text-sm text-red-600">{commit.error}</span>}
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
