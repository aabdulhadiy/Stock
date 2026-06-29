import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { workbookBuffer } from "./excel";
import { tablePdfBuffer } from "./pdf";
import { groupNumber, money } from "./format";

test("groupNumber and money are ASCII-safe", () => {
  assert.equal(groupNumber(1234567), "1 234 567");
  assert.equal(groupNumber(-5000), "-5 000");
  assert.equal(money(120000, "UZS"), "120 000 UZS");
  assert.equal(money(9.5, "USD"), "9.50 USD");
});

test("workbookBuffer round-trips with headers and cells", async () => {
  const buf = await workbookBuffer([
    {
      title: "Products",
      columns: [
        { header: "Name", key: "name" },
        { header: "Price", key: "price", numeric: true },
      ],
      rows: [
        { name: "Teddy", price: 75000 },
        { name: "Robot", price: 85000 },
      ],
    },
  ]);
  assert.ok(buf.length > 0);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet("Products");
  assert.ok(ws, "sheet exists");
  assert.equal(ws!.getCell("A1").value, "Name");
  assert.equal(ws!.getCell("A2").value, "Teddy");
  assert.equal(ws!.getCell("B3").value, 85000);
});

test("tablePdfBuffer returns a valid PDF", async () => {
  const buf = await tablePdfBuffer({
    title: "Stock levels",
    subtitle: "This month",
    tables: [
      {
        heading: "Warehouse",
        columns: [
          { header: "Product", key: "name", weight: 3 },
          { header: "Qty", key: "qty", weight: 1, align: "right" },
        ],
        rows: [
          { name: "Teddy", qty: 100 },
          { name: "Robot", qty: 0 },
        ],
      },
    ],
  });
  assert.ok(buf.length > 500, "non-trivial PDF size");
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");
});
