import { getCurrentUser } from "@/lib/auth";
import { resolveRange } from "@/lib/date-range";
import { buildSales } from "@/lib/export/build";
import { exportResponse, parseFormat } from "@/lib/export/respond";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  // Reports are Admin + Sales Manager only.
  if (user.role === "WAREHOUSE") return new Response("Forbidden", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const range = resolveRange({
    preset: sp.get("preset") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });
  const built = await buildSales(user, range);
  return exportResponse(parseFormat(req.url), built);
}
