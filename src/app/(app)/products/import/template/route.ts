import { getCurrentUser } from "@/lib/auth";
import { buildTemplate } from "@/lib/import";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return new Response("Forbidden", { status: 403 });
  }
  const buffer = await buildTemplate();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="product-import-template.xlsx"',
    },
  });
}
