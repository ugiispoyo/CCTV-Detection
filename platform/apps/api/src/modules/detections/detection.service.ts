import { notFound } from "../../lib/errors.js";
import { DetectionModel, type DetectionDocument } from "./detection.model.js";

export function serializeDetection(event: DetectionDocument) {
  return {
    eventId: event.eventId, cameraId: event.cameraId, sessionId: event.sessionId, trackId: event.trackId,
    objectType: event.objectType, eventType: event.eventType, direction: event.direction,
    ...(event.confidence !== undefined ? { confidence: event.confidence } : {}),
    timestamp: event.timestamp.toISOString(), createdAt: event.createdAt.toISOString(),
  };
}

export async function listDetections(query: { page: number; limit: number; cameraId?: string | undefined; objectType?: string | undefined; direction?: string | undefined; startDate?: string | undefined; endDate?: string | undefined }) {
  const filter: Record<string, unknown> = {};
  if (query.cameraId) filter.cameraId = query.cameraId;
  if (query.objectType) filter.objectType = query.objectType;
  if (query.direction) filter.direction = query.direction;
  if (query.startDate || query.endDate) {
    filter.timestamp = { ...(query.startDate ? { $gte: new Date(query.startDate) } : {}), ...(query.endDate ? { $lt: new Date(query.endDate) } : {}) };
  }
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    DetectionModel.find(filter).sort({ timestamp: -1 }).skip(skip).limit(query.limit).lean(),
    DetectionModel.countDocuments(filter),
  ]);
  return { items: items.map(serializeDetection), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function getDetection(eventId: string) {
  const event = await DetectionModel.findOne({ eventId }).lean();
  if (!event) throw notFound("Detection event not found");
  return serializeDetection(event);
}
