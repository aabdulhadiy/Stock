import { requireDirector } from "@/lib/auth";
import { importTemplateBuffer } from "@/lib/import";

/** Download the import template (§14: "developer provides the template"). */
export async function GET() {
  await requireDirector();
  const buf = await importTemplateBuffer();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="product-import-template.xlsx"',
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
