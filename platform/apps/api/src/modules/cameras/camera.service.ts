import { env } from "../../config/env.js";
import { conflict, notFound } from "../../lib/errors.js";
import { CameraModel, type CameraDocument } from "./camera.model.js";

type CameraInput = Pick<CameraDocument, "cameraId" | "name"> & { description?: string | undefined; location?: string | undefined; physicalCameraId?: string | undefined; lensName?: string | undefined; isActive?: boolean | undefined };
type CameraUpdate = { name?: string | undefined; description?: string | null | undefined; location?: string | null | undefined; physicalCameraId?: string | null | undefined; lensName?: string | null | undefined; isActive?: boolean | undefined };

function deriveStatus(camera: CameraDocument): CameraDocument["status"] {
  if (!camera.isActive) return "offline";
  if (!camera.lastHeartbeatAt) return "unknown";
  const age = Date.now() - camera.lastHeartbeatAt.getTime();
  return age <= env.HEARTBEAT_TIMEOUT_SECONDS * 1000 && camera.status === "online" ? "online" : "offline";
}

export function serializeCamera(camera: CameraDocument) {
  return {
    cameraId: camera.cameraId,
    name: camera.name,
    ...(camera.description ? { description: camera.description } : {}),
    ...(camera.location ? { location: camera.location } : {}),
    ...(camera.physicalCameraId ? { physicalCameraId: camera.physicalCameraId } : {}),
    ...(camera.lensName ? { lensName: camera.lensName } : {}),
    status: deriveStatus(camera),
    isActive: camera.isActive,
    ...(camera.lastHeartbeatAt ? { lastHeartbeatAt: camera.lastHeartbeatAt.toISOString() } : {}),
    createdAt: camera.createdAt.toISOString(),
    updatedAt: camera.updatedAt.toISOString(),
  };
}

export async function listCameras(query: { page: number; limit: number; search?: string | undefined; active?: "true" | "false" | undefined }) {
  const filter: Record<string, unknown> = {};
  if (query.active) filter.isActive = query.active === "true";
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ name: { $regex: escaped, $options: "i" } }, { cameraId: { $regex: escaped, $options: "i" } }, { location: { $regex: escaped, $options: "i" } }];
  }
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    CameraModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean(),
    CameraModel.countDocuments(filter),
  ]);
  return { items: items.map(serializeCamera), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function getCamera(cameraId: string) {
  const camera = await CameraModel.findOne({ cameraId }).lean();
  if (!camera) throw notFound("Camera not found");
  return serializeCamera(camera);
}

export async function createCamera(input: CameraInput) {
  try {
    const payload = {
      cameraId: input.cameraId,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.physicalCameraId !== undefined ? { physicalCameraId: input.physicalCameraId } : {}),
      ...(input.lensName !== undefined ? { lensName: input.lensName } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive, ...(input.isActive ? {} : { status: "offline" as const }) } : {}),
    };
    const camera = await CameraModel.create(payload);
    return serializeCamera(camera.toObject());
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw conflict("Camera ID already exists");
    throw error;
  }
}

export async function updateCamera(cameraId: string, input: CameraUpdate) {
  const update: Record<string, unknown> = { ...input };
  if (input.description === undefined) delete update.description;
  if (input.location === undefined) delete update.location;
  if (input.physicalCameraId === undefined) delete update.physicalCameraId;
  if (input.lensName === undefined) delete update.lensName;
  if (input.isActive === false) update.status = "offline";
  const camera = await CameraModel.findOneAndUpdate({ cameraId }, update, { new: true, runValidators: true }).lean();
  if (!camera) throw notFound("Camera not found");
  return serializeCamera(camera);
}

export async function deactivateCamera(cameraId: string) {
  const camera = await CameraModel.findOneAndUpdate(
    { cameraId },
    { isActive: false, status: "offline" },
    { new: true },
  ).lean();
  if (!camera) throw notFound("Camera not found");
  return serializeCamera(camera);
}
