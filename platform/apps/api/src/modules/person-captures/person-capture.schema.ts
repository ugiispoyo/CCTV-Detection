import { z } from "zod";
import { identifierSchema, isoDateSchema, paginationSchema, successSchema } from "../../lib/schemas.js";

export const captureIdSchema = z.uuid();
export const captureParamsSchema = z.object({ captureId: captureIdSchema });
export const captureIngestSchema = z.object({
  captureId: captureIdSchema, cameraId: identifierSchema, sessionId: identifierSchema.max(100),
  trackId: z.number().int().nonnegative().max(2_147_483_647), crossingId: identifierSchema.max(100), objectType: z.literal("person"),
  lineId: identifierSchema, direction: z.enum(["in", "out"]),
  confidence: z.number().min(0).max(1), capturedAt: isoDateSchema,
  fullBodyImageBase64: z.string().min(4).max(7_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/, "Invalid base64 image encoding"),
  headImageBase64: z.string().min(4).max(7_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/, "Invalid base64 image encoding").optional(),
}).meta({ example: { captureId: "8f95bb9f-d853-42df-b342-bc2af91ef9ce", cameraId: "cam-001", sessionId: "tracking-session-id", trackId: 24, crossingId: "crossing-event-uuid", lineId: "entry-line", direction: "in", objectType: "person", confidence: 0.94, capturedAt: "2026-11-06T11:30:00Z", fullBodyImageBase64: "/9j/4AAQ...", headImageBase64: "/9j/4AAQ..." } });

export const captureListQuerySchema = paginationSchema.extend({
  status: z.enum(["pending", "reviewed", "dismissed"]).optional(), direction: z.enum(["in", "out"]).optional(), cameraId: identifierSchema.optional(),
});
export const captureQualityQuerySchema = z.object({ cameraId: identifierSchema.optional(), since: isoDateSchema.optional() });
export const captureDtoSchema = z.object({
  captureId: z.string(), cameraId: z.string(), sessionId: z.string(), trackId: z.number(), crossingId: z.string(), lineId: z.string(), direction: z.enum(["in", "out"]), confidence: z.number(),
  capturedAt: z.string(), reviewStatus: z.enum(["pending", "reviewed", "dismissed"]), hasImage: z.boolean(), hasFullBodyImage: z.boolean(), hasHeadImage: z.boolean(),
  linkedPersonId: z.string().optional(), reviewedAt: z.string().optional(), reviewedBy: z.string().optional(), createdAt: z.string(), updatedAt: z.string(),
});
const paginationResponse = z.object({ page: z.number(), limit: z.number(), total: z.number(), totalPages: z.number() });
export const captureResponseSchema = successSchema(captureDtoSchema);
export const captureListResponseSchema = successSchema(z.object({ items: z.array(captureDtoSchema), pagination: paginationResponse }));
export const captureIngestResponseSchema = successSchema(z.object({ capture: captureDtoSchema, duplicate: z.boolean() }));
export const reviewCaptureSchema = z.object({ action: z.enum(["dismiss", "reopen"]), confirmed: z.literal(true) });
export const deleteCaptureSchema = z.object({ confirmed: z.literal(true) });
export const verifyCaptureSchema = z.object({ personId: identifierSchema, confirmed: z.literal(true) });
