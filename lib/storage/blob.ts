import { put, get, del } from "@vercel/blob";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Private file storage for contract PDFs.
 * - On Vercel: private Vercel Blob store (OIDC or BLOB_READ_WRITE_TOKEN).
 * - Locally without a token: files land in ./.blob-local (git-ignored).
 */

const LOCAL_DIR = path.join(process.cwd(), ".blob-local");

function isLocalStorage(): boolean {
  return !process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL;
}

export interface StoredFile {
  pathname: string;
  url: string | null;
}

export async function storeFile(pathname: string, data: Buffer, contentType?: string): Promise<StoredFile> {
  if (isLocalStorage()) {
    const full = path.join(LOCAL_DIR, pathname);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return { pathname, url: null };
  }
  const res = await put(pathname, data, {
    access: "private",
    addRandomSuffix: true,
    contentType,
  });
  return { pathname: res.pathname, url: res.url };
}

export async function readFile(pathname: string): Promise<{ stream: ReadableStream<Uint8Array>; contentType?: string } | null> {
  if (isLocalStorage()) {
    const full = path.join(LOCAL_DIR, pathname);
    try {
      const buf = await fs.readFile(full);
      return { stream: new Blob([buf]).stream() };
    } catch {
      return null;
    }
  }
  const res = await get(pathname, { access: "private" });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return { stream: res.stream, contentType: res.blob.contentType };
}

export async function readFileBuffer(pathname: string): Promise<Buffer | null> {
  const f = await readFile(pathname);
  if (!f) return null;
  const ab = await new Response(f.stream).arrayBuffer();
  return Buffer.from(ab);
}

export async function deleteFile(pathname: string): Promise<void> {
  if (isLocalStorage()) {
    await fs.rm(path.join(LOCAL_DIR, pathname), { force: true });
    return;
  }
  await del(pathname);
}
