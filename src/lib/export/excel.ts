import ExcelJS from "exceljs";
import type { ExportDoc } from "./types";

/** XLSX writer: one worksheet per table, bold frozen header, auto-filter. */
export async function workbookBuffer(doc: ExportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = doc.title;
  wb.created = new Date();

  const used = new Set<string>();

  for (const table of doc.tables) {
    // Excel tab names: 31 chars max, unique, and []*/\?: are illegal.
    const base = (table.title || "Sheet").replace(/[[\]*/\\?:]/g, " ").slice(0, 28);
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${base} ${n++}`;
    used.add(name.toLowerCase());

    const ws = wb.addWorksheet(name);

    // A title block above the table keeps context when a sheet is printed.
    ws.addRow([doc.title]).font = { bold: true, size: 14 };
    if (doc.subtitle) ws.addRow([doc.subtitle]).font = { color: { argb: "FF64748B" } };
    if (doc.note) {
      ws.addRow([doc.note]).font = { italic: true, color: { argb: "FF92400E" } };
    }
    ws.addRow([]);

    const headerRow = ws.addRow(table.columns.map((c) => c.header));
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFCBD5E1" } } };
    });
    ws.views = [{ state: "frozen", ySplit: headerRow.number }];

    for (const row of table.rows) {
      const added = ws.addRow(table.columns.map((c) => row[c.key] ?? null));
      table.columns.forEach((c, i) => {
        if (c.numeric) added.getCell(i + 1).alignment = { horizontal: "right" };
      });
    }

    if (table.totals) {
      const totals = ws.addRow(table.columns.map((c) => table.totals![c.key] ?? null));
      totals.font = { bold: true };
      totals.eachCell((cell) => {
        cell.border = { top: { style: "double", color: { argb: "FF94A3B8" } } };
      });
      table.columns.forEach((c, i) => {
        if (c.numeric) totals.getCell(i + 1).alignment = { horizontal: "right" };
      });
    }

    table.columns.forEach((c, i) => {
      const column = ws.getColumn(i + 1);
      if (c.width) {
        column.width = c.width;
        return;
      }
      // Size to the widest value, within sane bounds.
      let widest = c.header.length;
      for (const row of table.rows) {
        const len = String(row[c.key] ?? "").length;
        if (len > widest) widest = len;
      }
      column.width = Math.min(50, Math.max(10, widest + 2));
    });

    ws.autoFilter = {
      from: { row: headerRow.number, column: 1 },
      to: { row: headerRow.number, column: table.columns.length },
    };
  }

  if (doc.tables.length === 0) wb.addWorksheet("Report").addRow([doc.title]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
