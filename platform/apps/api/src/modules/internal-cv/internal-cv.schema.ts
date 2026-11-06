import { z } from "zod";
import { cameraStatusSchema, directionSchema, identifierSchema, isoDateSchema, objectTypeSchema, successSchema } from "../../lib/schemas.js";
import { detectionDtoSchema } from "../detections/detection.schema.js";

export const cvEventSchema = z.object({
  eventId: identifierSchema.max(100), cameraId: identifierSchema, sessionId: identifierSchema.max(100),
  trackId: z.number().int().nonnegative().max(2_147_483_647), objectType: objectTypeSchema,
  eventType: z.literal("line_crossing"), direction: directionSchema, confidence: z.number().min(0).max(1).optional(),
  timestamp: isoDateSchema,
}).meta({ example: {
  eventId: "cam-001-session-a-42-in", cameraId: "cam-001", sessionId: "session-a", trackId: 42,
  objectType: "person", eventType: "line_crossing", direction: "in", confidence: 0.94, timestamp: "2026-11-06T03:00:00Z",
} });

export const heartbeatSchema = z.object({
  workerId: identifierSchema, cameraId: identifierSchema, status: cameraStatusSchema.exclude(["unknown"]), timestamp: isoDateSchema,
}).meta({ example: { workerId: "cv-worker-001", cameraId: "cam-001", status: "online", timestamp: "2026-11-06T03:00:00Z" } });

export const cvEventResponseSchema = successSchema(z.object({ event: detectionDtoSchema, duplicate: z.boolean() }));
export const heartbeatResponseSchema = successSchema(z.object({ cameraId: z.string(), status: cameraStatusSchema, lastHeartbeatAt: z.string() }));
export const cvConfigResponseSchema = successSchema(z.object({
  cameras: z.array(z.object({
    cameraId: z.string(), name: z.string(), enabled: z.boolean(), allowedObjectClasses: z.array(objectTypeSchema), countingLine: z.null(),
  })),
}));
