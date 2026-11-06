import { z } from "zod";
import { cameraStatusSchema, identifierSchema, optionalTextSchema, paginationSchema, successSchema, textSchema } from "../../lib/schemas.js";

export const cameraDtoSchema = z.object({
  cameraId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  physicalCameraId: z.string().optional(),
  lensName: z.string().optional(),
  status: cameraStatusSchema,
  isActive: z.boolean(),
  lastHeartbeatAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createCameraSchema = z.object({
  cameraId: identifierSchema,
  name: textSchema,
  description: optionalTextSchema,
  location: z.string().trim().max(200).optional(),
  physicalCameraId: identifierSchema.optional(),
  lensName: z.string().trim().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
}).meta({ example: { cameraId: "cam-001", name: "Front entrance", location: "Lobby", description: "Counts entry and exit traffic" } });

export const updateCameraSchema = z.object({
  name: textSchema.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  physicalCameraId: identifierSchema.nullable().optional(),
  lensName: z.string().trim().min(1).max(80).nullable().optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const cameraParamsSchema = z.object({ cameraId: identifierSchema });
export const cameraListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  active: z.enum(["true", "false"]).optional(),
});

export const cameraResponseSchema = successSchema(cameraDtoSchema);
export const cameraListResponseSchema = successSchema(z.object({
  items: z.array(cameraDtoSchema),
  pagination: z.object({ page: z.number(), limit: z.number(), total: z.number(), totalPages: z.number() }),
}));
