export const PREVIEW_MAGIC = "CCTV";
export const PREVIEW_PROTOCOL_VERSION = 1;
export const PREVIEW_HEADER_BYTES = 32;

export interface PreviewFrameMetadata {
  sequence: bigint;
  timestampMs: bigint;
  width: number;
  height: number;
  jpegBytes: number;
}

export interface PreviewRegistration {
  type: "preview.register";
  version: 1;
  cameraId: string;
  workerId: string;
}

export interface PreviewObjectsMessage {
  type: "preview.objects";
  version: 1;
  sequence: number;
  timestamp: number;
  counts: { person: number; car: number; motorcycle: number };
  tracks: Array<{ trackId: number; objectType: "person" | "car" | "motorcycle"; bbox: [number, number, number, number] }>;
  sessionId: string;
}

export function parsePreviewFrame(frame: Buffer, maximumBytes: number): PreviewFrameMetadata | null {
  if (frame.length < PREVIEW_HEADER_BYTES || frame.length > maximumBytes + PREVIEW_HEADER_BYTES) return null;
  if (frame.subarray(0, 4).toString("ascii") !== PREVIEW_MAGIC) return null;
  if (frame.readUInt8(4) !== PREVIEW_PROTOCOL_VERSION || frame.readUInt16BE(6) !== PREVIEW_HEADER_BYTES) return null;
  const width = frame.readUInt16BE(24);
  const height = frame.readUInt16BE(26);
  const jpegBytes = frame.readUInt32BE(28);
  if (width < 1 || height < 1 || width > 4096 || height > 2160) return null;
  if (jpegBytes < 4 || jpegBytes > maximumBytes || frame.length !== PREVIEW_HEADER_BYTES + jpegBytes) return null;
  if (frame[PREVIEW_HEADER_BYTES] !== 0xff || frame[PREVIEW_HEADER_BYTES + 1] !== 0xd8) return null;
  if (frame[frame.length - 2] !== 0xff || frame[frame.length - 1] !== 0xd9) return null;
  return {
    sequence: frame.readBigUInt64BE(8),
    timestampMs: frame.readBigUInt64BE(16),
    width,
    height,
    jpegBytes,
  };
}

export function parseRegistration(value: string): PreviewRegistration | null {
  try {
    const candidate = JSON.parse(value) as Record<string, unknown>;
    if (
      candidate.type !== "preview.register" || candidate.version !== PREVIEW_PROTOCOL_VERSION ||
      typeof candidate.cameraId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(candidate.cameraId) ||
      typeof candidate.workerId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(candidate.workerId)
    ) return null;
    return candidate as unknown as PreviewRegistration;
  } catch {
    return null;
  }
}

export function parsePreviewObjects(value: string): PreviewObjectsMessage | null {
  try {
    const candidate = JSON.parse(value) as Record<string, unknown>;
    const counts = candidate.counts as Record<string, unknown> | undefined;
    const tracks = candidate.tracks;
    if (
      candidate.type !== "preview.objects" || candidate.version !== PREVIEW_PROTOCOL_VERSION ||
      typeof candidate.sequence !== "number" || !Number.isSafeInteger(candidate.sequence) || candidate.sequence < 0 ||
      typeof candidate.timestamp !== "number" || !Number.isSafeInteger(candidate.timestamp) ||
      typeof candidate.sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(candidate.sessionId) ||
      !counts || ![counts.person, counts.car, counts.motorcycle].every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 1_000) ||
      !Array.isArray(tracks) || tracks.length > 500 || !tracks.every((track) => {
        if (!track || typeof track !== "object") return false;
        const value = track as Record<string, unknown>;
        return typeof value.trackId === "number" && Number.isSafeInteger(value.trackId) && value.trackId >= 0 &&
          ["person", "car", "motorcycle"].includes(String(value.objectType)) && Array.isArray(value.bbox) && value.bbox.length === 4 &&
          value.bbox.every((coordinate) => typeof coordinate === "number" && coordinate >= 0 && coordinate <= 1);
      })
    ) return null;
    return candidate as unknown as PreviewObjectsMessage;
  } catch {
    return null;
  }
}

