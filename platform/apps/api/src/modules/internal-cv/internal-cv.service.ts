import mongoose from "mongoose";
import type { DetectionEvent, ObjectType } from "@cctv-ai/shared";
import { AppError, notFound } from "../../lib/errors.js";
import { CameraModel } from "../cameras/camera.model.js";
import { DetectionModel } from "../detections/detection.model.js";
import { serializeDetection } from "../detections/detection.service.js";
import { CountingSummaryModel } from "../statistics/counting-summary.model.js";

function validateEventTimestamp(timestamp: Date): void {
  const age = Date.now() - timestamp.getTime();
  if (age < -5 * 60_000) throw new AppError(400, "INVALID_TIMESTAMP", "Event timestamp is too far in the future");
  if (age > 30 * 24 * 60 * 60_000) throw new AppError(400, "INVALID_TIMESTAMP", "Event timestamp is older than 30 days");
}

type IngestEventInput = Omit<DetectionEvent, "confidence"> & { confidence?: number | undefined };

export async function ingestEvent(input: IngestEventInput) {
  const existing = await DetectionModel.findOne({ eventId: input.eventId }).lean();
  if (existing) return { event: serializeDetection(existing), duplicate: true, summaryCount: undefined };

  const timestamp = new Date(input.timestamp);
  validateEventTimestamp(timestamp);
  const camera = await CameraModel.findOne({ cameraId: input.cameraId }).lean();
  if (!camera) throw notFound("Referenced camera does not exist");
  if (!camera.isActive) throw new AppError(409, "CAMERA_INACTIVE", "Referenced camera is inactive");

  const periodStart = new Date(timestamp);
  periodStart.setUTCMinutes(0, 0, 0);
  const session = await mongoose.startSession();
  let persisted: Awaited<ReturnType<typeof DetectionModel.create>>[number] | undefined;
  let summaryCount: number | undefined;
  try {
    await session.withTransaction(async () => {
      const { confidence, ...requiredFields } = input;
      [persisted] = await DetectionModel.create([{ ...requiredFields, ...(confidence !== undefined ? { confidence } : {}), timestamp }], { session });
      const summary = await CountingSummaryModel.findOneAndUpdate(
        { cameraId: input.cameraId, objectType: input.objectType, direction: input.direction, periodType: "hour", periodStart },
        { $inc: { count: 1 }, $set: { updatedAt: new Date() }, $setOnInsert: { periodType: "hour" } },
        { upsert: true, new: true, session, runValidators: true },
      ).lean();
      summaryCount = summary?.count;
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await DetectionModel.findOne({ eventId: input.eventId }).lean();
      if (duplicate) return { event: serializeDetection(duplicate), duplicate: true, summaryCount: undefined };
    }
    throw error;
  } finally {
    await session.endSession();
  }
  if (!persisted) throw new AppError(500, "PERSISTENCE_ERROR", "Event transaction did not produce a record");
  return { event: serializeDetection(persisted.toObject()), duplicate: false, summaryCount };
}

export async function recordHeartbeat(input: { workerId: string; cameraId: string; status: "online" | "offline"; timestamp: string }) {
  const timestamp = new Date(input.timestamp);
  if (timestamp.getTime() > Date.now() + 5 * 60_000) throw new AppError(400, "INVALID_TIMESTAMP", "Heartbeat timestamp is too far in the future");
  const current = await CameraModel.findOne({ cameraId: input.cameraId }).lean();
  if (!current) throw notFound("Referenced camera does not exist");
  if (!current.isActive) throw new AppError(409, "CAMERA_INACTIVE", "Referenced camera is inactive");
  if (current.lastHeartbeatAt && timestamp <= current.lastHeartbeatAt) {
    return { cameraId: current.cameraId, status: current.status, lastHeartbeatAt: current.lastHeartbeatAt.toISOString(), changed: false };
  }
  const camera = await CameraModel.findOneAndUpdate(
    { cameraId: input.cameraId, isActive: true },
    { status: input.status, lastHeartbeatAt: timestamp, lastWorkerId: input.workerId },
    { new: true },
  ).lean();
  if (!camera) throw notFound("Referenced camera does not exist");
  return { cameraId: camera.cameraId, status: camera.status, lastHeartbeatAt: timestamp.toISOString(), changed: current.status !== camera.status };
}

export async function getWorkerConfig() {
  const cameras = await CameraModel.find({ isActive: true }).sort({ cameraId: 1 }).lean();
  const allowedObjectClasses: ObjectType[] = ["person", "car", "motorcycle"];
  return { cameras: cameras.map((camera) => ({
    cameraId: camera.cameraId, name: camera.name, enabled: camera.isActive,
    allowedObjectClasses, countingLine: null,
  })) };
}
