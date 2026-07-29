import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Local file storage for product images (§3.1) and expense receipts (§9.2).
 *
 * Files live on a mounted volume outside the build output, never in `public/`:
 * a standalone Next build does not carry `public/` into the image, and uploads
 * must survive a container rebuild (§16.1). They are served back through an
 * authenticated route handler, so an unauthenticated URL guess returns nothing.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // §3.1: ≤5 MB each
const ALLOWED = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
]);

export type UploadKind = "products" | "receipts";

function uploadRoot(): string {
  return process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(process.cwd(), "var", "uploads");
}

export type UploadError = "TYPE" | "SIZE";

export interface SavedUpload {
  /** Storage key, e.g. "products/ab/abcd1234.jpg". Stored in the DB. */
  key: string;
  /** URL the app renders. */
  url: string;
  bytes: number;
}

/** True when a FormData entry is a file the user actually chose. */
export function isFilled(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

/**
 * Validate and store one image. Returns a discriminated result rather than
 * throwing, so the caller can surface a translated field error.
 */
export async function saveImage(
  file: File,
  kind: UploadKind,
): Promise<{ ok: true; upload: SavedUpload } | { ok: false; error: UploadError }> {
  const ext = ALLOWED.get(file.type);
  if (!ext) return { ok: false, error: "TYPE" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "SIZE" };

  const bytes = Buffer.from(await file.arrayBuffer());

  // Verify the magic bytes rather than trusting the declared Content-Type — the
  // header is attacker-controlled, the file signature is not.
  if (!looksLikeImage(bytes, ext)) return { ok: false, error: "TYPE" };

  const id = crypto.randomBytes(16).toString("hex");
  // Two-character shard keeps directories small at tens of thousands of files.
  const shard = id.slice(0, 2);
  const key = `${kind}/${shard}/${id}${ext}`;
  const target = path.join(uploadRoot(), key);

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);

  return { ok: true, upload: { key, url: `/uploads/${key}`, bytes: bytes.length } };
}

function looksLikeImage(bytes: Buffer, ext: string): boolean {
  if (ext === ".png") {
    return (
      bytes.length > 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  // JPEG: FF D8 FF
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Resolve a storage key to an absolute path, refusing anything that escapes the
 * upload root — the defence against `../../etc/passwd` in a URL.
 */
export function resolveUploadPath(key: string): string | null {
  if (!key || key.includes("\0")) return null;
  const root = uploadRoot();
  const target = path.resolve(root, key);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!target.startsWith(rootWithSep)) return null;
  return target;
}

export function contentTypeFor(key: string): string {
  return key.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

/** Delete a stored file. A missing file is not an error — the goal is absence. */
export async function deleteUpload(urlOrKey: string): Promise<void> {
  const key = urlOrKey.replace(/^\/uploads\//, "");
  const target = resolveUploadPath(key);
  if (!target) return;
  await fs.rm(target, { force: true });
}
