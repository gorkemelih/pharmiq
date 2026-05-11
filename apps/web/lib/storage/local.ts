/**
 * PharmIQ — Local File Storage (Demo)
 *
 * Demo localhost only — yüklenen PDF'leri apps/web/storage/ altında tutuyoruz.
 * Production'da Azure Blob (plan §6.1) ile değiştirilir.
 */

import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const STORAGE_ROOT =
  process.env.PHARMIQ_STORAGE_DIR ??
  resolve(process.cwd(), "storage", "documents");

async function ensureStorageDir() {
  if (!existsSync(STORAGE_ROOT)) {
    await mkdir(STORAGE_ROOT, { recursive: true });
  }
}

export async function saveUpload(
  buffer: Buffer,
  filename: string
): Promise<{ id: string; path: string }> {
  await ensureStorageDir();
  const id = randomUUID();
  // Dosya adı path traversal'ı engellemek için sadece basename + UUID
  const safeName = `${id}__${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const path = join(STORAGE_ROOT, safeName);
  await writeFile(path, buffer);
  return { id, path };
}

export async function readUpload(path: string): Promise<Buffer> {
  return readFile(path);
}

export async function deleteUpload(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }
}
