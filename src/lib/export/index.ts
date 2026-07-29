import { workbookBuffer } from "./excel";
import { tablePdfBuffer } from "./pdf";
import { safeFilename, type ExportDoc, type ExportFormat } from "./types";

export * from "./types";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Render a document and return it as a download.
 *
 * The whole buffer is built before the Response is constructed on purpose: the
 * Next.js docs note that once streaming starts you can no longer change status
 * or headers, so authorization and generation must both finish first. A failed
 * export then still produces a clean error page rather than a truncated file.
 */
export async function exportResponse(
  format: ExportFormat,
  doc: ExportDoc,
): Promise<Response> {
  const name = safeFilename(doc.filenameBase);

  if (format === "pdf") {
    const buf = await tablePdfBuffer(doc);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}.pdf"`,
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  }

  const buf = await workbookBuffer(doc);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
