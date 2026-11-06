import { z } from "zod";
import { directionSchema, identifierSchema, isoDateSchema, objectTypeSchema, paginationSchema, successSchema } from "../../lib/schemas.js";

export const detectionDtoSchema = z.object({
  eventId: z.string(), cameraId: z.string(), sessionId: z.string(), trackId: z.number(),
  objectType: objectTypeSchema, eventType: z.literal("line_crossing"), direction: directionSchema,
  confidence: z.number().optional(), timestamp: z.string(), createdAt: z.string(),
});

export const detectionParamsSchema = z.object({ eventId: identifierSchema.max(100) });
export const detectionQuerySchema = paginationSchema.extend({
  cameraId: identifierSchema.optional(), objectType: objectTypeSchema.optional(), direction: directionSchema.optional(),
  startDate: isoDateSchema.optional(), endDate: isoDateSchema.optional(),
}).refine((value) => !value.startDate || !value.endDate || new Date(value.startDate) < new Date(value.endDate), "startDate must precede endDate");

export const detectionResponseSchema = successSchema(detectionDtoSchema);
export const detectionListResponseSchema = successSchema(z.object({
  items: z.array(detectionDtoSchema),
  pagination: z.object({ page: z.number(), limit: z.number(), total: z.number(), totalPages: z.number() }),
}));
