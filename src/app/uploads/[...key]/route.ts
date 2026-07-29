import fs from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getCurrentUser } from "@/lib/auth";
import { contentTypeFor, resolveUploadPath } from "@/lib/uploads";

/**
 * Serve uploaded images. Behind auth on purpose: product photos and expense
 * receipts are business documents, and §14 does not permit them to be readable
 * by anyone who guesses a URL.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ key: string[] }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { key } = await ctx.params;
  const target = resolveUploadPath(key.join("/"));
  if (!target) return new Response("Not found", { status: 404 });

  let size: number;
  try {
    const info = await stat(target);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    size = info.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const stream = Readable.toWeb(
    fs.createReadStream(target),
  ) as unknown as ReadableStream;

  return new Response(stream, {
    headers: {
      "Content-Type": contentTypeFor(target),
      "Content-Length": String(size),
      // Content is immutable (random filename), but keep it private to the user.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
