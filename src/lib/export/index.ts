import { workbookBuffer } from "./excel";
import { tablePdfBuffer } from "./pdf";
import {
  contentDisposition,
  safeFilename,
  type ExportDoc,
  type ExportFormat,
} from "./types";

export * from "./types";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Render a document and return it as a download.
 *
 * The whole buffer is built before the Response is constructed on purpose: the
 * Next.js docs note that once streaming starts you can no longer change the
 * status or headers, so authorization and generation must both finish first. A
 * failed export then still produces a clean error rather than a truncated file.
 */
export async function exportResponse(
  format: ExportFormat,
  doc: ExportDoc,
): Promise<Response> {
  const name = safeFilename(doc.filenameBase);

  const [buf, type, ext] =
    format === "pdf"
      ? [await tablePdfBuffer(doc), "application/pdf", "pdf"]
      : [await workbookBuffer(doc), XLSX_TYPE, "xlsx"];

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": contentDisposition(name, ext),
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
