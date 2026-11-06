import { z } from "zod";

export const identifierSchema = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const textSchema = z.string().trim().min(1).max(200);
export const optionalTextSchema = z.string().trim().max(500).optional();
export const objectTypeSchema = z.enum(["person", "car", "motorcycle"]);
export const directionSchema = z.enum(["in", "out"]);
export const cameraStatusSchema = z.enum(["online", "offline", "unknown"]);
export const isoDateSchema = z.iso.datetime({ offset: true });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export function successSchema<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data });
}

export function ok<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}
