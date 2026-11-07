import { link, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

const root = resolve(env.PERSON_CAPTURE_STORAGE_DIR);

function safePath(relativePath: string): string {
  if (isAbsolute(relativePath)) throw new AppError(400, "INVALID_IMAGE_PATH", "Invalid image reference");
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new AppError(400, "INVALID_IMAGE_PATH", "Invalid image reference");
  return target;
}

export function inspectJpeg(image: Buffer): { width: number; height: number } {
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image.at(-2) !== 0xff || image.at(-1) !== 0xd9) {
    throw new AppError(400, "INVALID_IMAGE", "Only a valid JPEG image is accepted");
  }
  let offset = 2;
  while (offset + 8 < image.length) {
    if (image[offset] !== 0xff) { offset += 1; continue; }
    const marker = image[offset + 1] ?? 0;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = image.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > image.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: image.readUInt16BE(offset + 5), width: image.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new AppError(400, "INVALID_IMAGE", "JPEG dimensions could not be validated");
}

export async function storeCaptureImage(cameraId: string, captureId: string, kind: "full-body" | "head", capturedAt: Date, image: Buffer): Promise<string> {
  const relativePath = `${cameraId}/${capturedAt.getUTCFullYear()}/${String(capturedAt.getUTCMonth() + 1).padStart(2, "0")}/${captureId}/${kind}.jpg`;
  const destination = safePath(relativePath);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, image, { mode: 0o600, flag: "wx" });
  try {
    await link(temporary, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return relativePath;
}

export async function readCaptureImage(relativePath: string): Promise<Buffer> {
  return readFile(safePath(relativePath));
}

export async function removeCaptureImage(relativePath: string): Promise<void> {
  await rm(safePath(relativePath), { force: true });
}

export async function ensureCaptureStorage(): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const handle = await open(root, "r");
  await handle.close();
}

export function captureStorageRoot(): string { return root; }
