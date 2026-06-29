import ExcelJS from "exceljs";

/** Generic Excel export: one worksheet per sheet spec, bold header row. */

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
  numeric?: boolean;
}

export interface ExcelSheet {
  title: string;
  columns: ExcelColumn[];
  rows: Record<string, string | number | null>[];
}

export async function workbookBuffer(sheets: ExcelSheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Toy Inventory & Sales";

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.title.slice(0, 31)); // Excel tab name limit
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? Math.max(12, c.header.length + 2),
    }));
    ws.getRow(1).font = { bold: true };
    for (const row of sheet.rows) ws.addRow(row);

    // Right-align numeric columns.
    sheet.columns.forEach((c, i) => {
      if (c.numeric) ws.getColumn(i + 1).alignment = { horizontal: "right" };
    });
  }

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}
