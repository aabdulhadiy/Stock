import { workbookBuffer } from "./excel";
import { tablePdfBuffer } from "./pdf";
import type { BuiltExport } from "./build";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type ExportFormat = "xlsx" | "pdf";

export function parseFormat(url: string): ExportFormat {
  const fmt = new URL(url).searchParams.get("format");
  return fmt === "pdf" ? "pdf" : "xlsx";
}

export async function exportResponse(
  format: ExportFormat,
  built: BuiltExport,
): Promise<Response> {
  if (format === "pdf") {
    const buf = await tablePdfBuffer(built.pdf);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${built.filenameBase}.pdf"`,
      },
    });
  }
  const buf = await workbookBuffer(built.sheets);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${built.filenameBase}.xlsx"`,
    },
  });
}
