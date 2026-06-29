import { getCurrentUser } from "@/lib/auth";
import { buildStock } from "@/lib/export/build";
import { exportResponse, parseFormat } from "@/lib/export/respond";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  // Stock levels are viewable by all roles (column scope handled in buildStock).
  const built = await buildStock(user);
  return exportResponse(parseFormat(req.url), built);
}
