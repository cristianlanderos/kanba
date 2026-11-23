// Where uploaded images live: a folder on the server's disk. A file is named by the
// SHA-256 of its content, so the same picture is stored once however often it is
// attached, and a name never changes what it shows.

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { adminDb } from './admin';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** What a browser shows as a picture. No SVG: one can carry script. */
export const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const FILE = /^[0-9a-f]{64}\.(png|jpg|gif|webp)$/;

export const isImageFile = (file: string) => FILE.test(file);

export const contentTypeOf = (file: string) =>
  Object.keys(IMAGE_TYPES).find((type) => file.endsWith(`.${IMAGE_TYPES[type]}`)) || 'application/octet-stream';

export function uploadsDir(): string {
  return process.env.KANBA_UPLOADS || path.join(process.cwd(), 'uploads');
}

/** Only ever called with a name that passed `isImageFile`, so it cannot leave the folder. */
export const pathOf = (file: string) => path.join(uploadsDir(), file);

/** Stores `bytes` and returns the file's name. */
export async function saveImage(bytes: Buffer, contentType: string): Promise<string> {
  const file = `${createHash('sha256').update(bytes).digest('hex')}.${IMAGE_TYPES[contentType]}`;
  await fs.mkdir(uploadsDir(), { recursive: true });
  const target = pathOf(file);
  // A half-written file never takes the real name.
  const partial = `${target}.${process.pid}.part`;
  await fs.writeFile(partial, bytes);
  await fs.rename(partial, target);
  return file;
}

/** Removes `file` from the disk once no task shows it. */
export async function dropIfUnused(file: string): Promise<void> {
  if (!isImageFile(file)) return;
  const { count } = await adminDb.from('task_images').select('*', { count: 'exact', head: true }).eq('file', file);
  if (!count) await fs.unlink(pathOf(file)).catch(() => {});
}

let swept = 0;
const SWEEP_EVERY = 60 * 60 * 1000;

/**
 * Deleting a task takes its image rows with it, in the database, where no file can be
 * removed. So now and then the folder is compared with the table, and files that nothing
 * shows go. Files newer than an hour stay: one may be between its upload and its row.
 */
export async function sweepUnused(): Promise<void> {
  if (Date.now() - swept < SWEEP_EVERY) return;
  swept = Date.now();
  try {
    const { data, error } = await adminDb.from('task_images').select('file');
    if (error) return;
    const used = new Set((data || []).map((row: any) => row.file));
    for (const file of await fs.readdir(uploadsDir())) {
      if (used.has(file)) continue;
      const stat = await fs.stat(pathOf(file)).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > SWEEP_EVERY) await fs.unlink(pathOf(file)).catch(() => {});
    }
  } catch (error) {
    console.error('kanba: could not clean the uploads folder', error);
  }
}
