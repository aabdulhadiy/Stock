import { getCurrentUser } from "@/lib/auth";
import { buildProducts } from "@/lib/export/build";
import { exportResponse, parseFormat } from "@/lib/export/respond";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  // Catalog is viewable by all roles.
  const built = await buildProducts(user);
  return exportResponse(parseFormat(req.url), built);
}
