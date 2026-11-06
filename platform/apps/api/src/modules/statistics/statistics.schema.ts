import { z } from "zod";
import { directionSchema, identifierSchema, isoDateSchema, objectTypeSchema, successSchema } from "../../lib/schemas.js";

export const rangeQuerySchema = z.object({
  range: z.enum(["today", "yesterday", "7d", "30d", "custom"]).default("today"),
  startDate: isoDateSchema.optional(), endDate: isoDateSchema.optional(), timezone: z.string().min(1).max(100).optional(),
});

export const statisticsQuerySchema = rangeQuerySchema.extend({ cameraId: identifierSchema.optional() });
export const cameraStatisticsParamsSchema = z.object({ cameraId: identifierSchema });

export const countBucketSchema = z.object({ objectType: objectTypeSchema, direction: directionSchema, count: z.number() });
export const summaryDataSchema = z.object({
  startDate: z.string(), endDate: z.string(), timezone: z.string(), totalEvents: z.number(), buckets: z.array(countBucketSchema),
});
export const summaryResponseSchema = successSchema(summaryDataSchema);
export const cameraSummaryResponseSchema = successSchema(summaryDataSchema.extend({ cameraId: z.string() }));
export const timelineResponseSchema = successSchema(z.object({
  startDate: z.string(), endDate: z.string(), timezone: z.string(),
  items: z.array(countBucketSchema.extend({ periodStart: z.string(), cameraId: z.string().optional() })),
}));
