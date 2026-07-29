import test from "node:test";
import assert from "node:assert/strict";
import { workbookBuffer } from "./excel";
import { tablePdfBuffer } from "./pdf";
import { contentDisposition, safeFilename, parseFormat } from "./types";
import type { ExportDoc } from "./types";

/**
 * Export writer tests. The Content-Disposition cases exist because export
 * titles are translated (§13): a Russian or Uzbek filename contains characters
 * outside the byte range HTTP headers allow, which crashed the download until
 * the header was RFC 6266 encoded.
 */

const doc = (title: string): ExportDoc => ({
  filenameBase: title,
  title,
  subtitle: "01.01.2026 — 31.01.2026",
  tables: [
    {
      title,
      columns: [
        { header: "Артикул", key: "sku" },
        { header: "Nomi", key: "name" },
        { header: "Qoldiq", key: "qty", numeric: true },
      ],
      rows: [
        { sku: "TOY-001", name: "Ayiqcha 30sm", qty: 120 },
        { sku: "TOY-002", name: "Мяч резиновый", qty: 40 },
      ],
      totals: { name: "Jami", qty: 160 },
    },
  ],
});

test("Content-Disposition stays a valid ASCII header for Cyrillic filenames", () => {
  const value = contentDisposition(safeFilename("Остаток товара 2026"), "pdf");

  // The whole header must be representable as a ByteString, or the runtime
  // throws when the Response is constructed.
  for (const ch of value) {
    assert.ok(
      ch.charCodeAt(0) <= 255,
      `header contains non-latin1 character ${JSON.stringify(ch)}`,
    );
  }
  assert.match(value, /^attachment; filename="[\x20-\x7E]*"; filename\*=UTF-8''/);
  // The UTF-8 parameter round-trips to the original name.
  const encoded = value.split("filename*=UTF-8''")[1];
  assert.equal(decodeURIComponent(encoded), "Остаток-товара-2026.pdf");
});

test("Content-Disposition keeps a usable ASCII fallback name", () => {
  const value = contentDisposition(safeFilename("Ombor qoldig'i"), "xlsx");
  const fallback = /filename="([^"]*)"/.exec(value)?.[1];
  assert.equal(fallback, "Ombor-qoldigi.xlsx");
});

test("a filename with no ASCII characters at all still yields a valid name", () => {
  const value = contentDisposition(safeFilename("Отчёт"), "pdf");
  const fallback = /filename="([^"]*)"/.exec(value)?.[1];
  assert.equal(fallback, "export.pdf", "must not degrade to a bare extension");
});

test("safeFilename strips path separators and quotes", () => {
  assert.equal(safeFilename('../../etc/pa"ss wd'), "etc-pass-wd");
  assert.equal(safeFilename(""), "export");
});

test("parseFormat defaults to xlsx and only accepts pdf", () => {
  assert.equal(parseFormat("pdf"), "pdf");
  assert.equal(parseFormat("xlsx"), "xlsx");
  assert.equal(parseFormat(null), "xlsx");
  assert.equal(parseFormat("../etc/passwd"), "xlsx");
});

test("the XLSX writer produces a real workbook", async () => {
  const buf = await workbookBuffer(doc("Остаток"));
  assert.ok(buf.length > 1000, "workbook is suspiciously small");
  // XLSX is a zip: "PK\x03\x04".
  assert.deepEqual([...buf.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});

test("the PDF writer produces a real PDF and embeds a Unicode font", async () => {
  const buf = await tablePdfBuffer(doc("Остаток товара"));
  assert.ok(buf.length > 1000, "pdf is suspiciously small");
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");

  // DejaVu must actually be embedded, otherwise Cyrillic would render as
  // blanks with pdfkit's built-in WinAnsi fonts.
  const text = buf.toString("latin1");
  assert.match(text, /DejaVuSans/, "expected the DejaVu font to be embedded");
});

test("an empty document still exports without throwing", async () => {
  const empty: ExportDoc = { filenameBase: "empty", title: "Empty", tables: [] };
  const xlsx = await workbookBuffer(empty);
  const pdf = await tablePdfBuffer(empty);
  assert.ok(xlsx.length > 0);
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
});
