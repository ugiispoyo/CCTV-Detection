import { z } from "zod";
import { identifierSchema, successSchema } from "../../lib/schemas.js";

export const datasetClassSchema = z.enum(["person", "head", "car", "motorcycle"]);
const annotationFieldsSchema = z.object({
  captureId: z.uuid(), imageKind: z.enum(["full-body", "head"]), className: datasetClassSchema,
  xCenter: z.number().min(0).max(1), yCenter: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1),
});
export const annotationInputSchema = annotationFieldsSchema.refine((value) => value.xCenter - value.width / 2 >= 0 && value.xCenter + value.width / 2 <= 1 && value.yCenter - value.height / 2 >= 0 && value.yCenter + value.height / 2 <= 1, "Bounding box must remain inside the image");
export const annotationParamsSchema = z.object({ annotationId: z.uuid() });
export const annotationUpdateSchema = annotationFieldsSchema.omit({ captureId: true }).partial().extend({ status: z.enum(["draft", "approved", "rejected"]).optional() });
export const exportDatasetSchema = z.object({ confirmed: z.literal(true) });
export const modelVersionSchema = z.object({ datasetVersionId: identifierSchema, modelPath: z.string().min(1).max(500), parameters: z.record(z.string(), z.unknown()), metrics: z.object({ precision: z.number().min(0).max(1), recall: z.number().min(0).max(1), map50: z.number().min(0).max(1), map50_95: z.number().min(0).max(1), perClass: z.record(z.string(), z.unknown()).optional() }) });
export const genericResponseSchema = successSchema(z.unknown());
