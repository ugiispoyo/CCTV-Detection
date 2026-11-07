import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponseSchema, ok } from "../../lib/schemas.js";
import { requireOperator } from "../../plugins/operator-auth.js";
import { annotationInputSchema, annotationParamsSchema, annotationUpdateSchema, exportDatasetSchema, genericResponseSchema, modelVersionSchema } from "./dataset.schema.js";
import { activateModelVersion, approveModelVersion, createAnnotation, exportDataset, listAnnotationHistory, listAnnotations, listDatasetVersions, listModelVersions, registerModelVersion, rejectModelVersion, updateAnnotation } from "./dataset.service.js";

const errors = { 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema };
const security = [{ operatorAuth: [] }];
export const datasetRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("onRequest", requireOperator);
  app.get("/api/dataset/annotations", { schema: { tags: ["Detection Dataset"], security, querystring: z.object({ captureId: z.uuid().optional() }), response: { 200: genericResponseSchema, ...errors } } }, async (request) => ok(await listAnnotations(request.query.captureId)));
  app.post("/api/dataset/annotations", { schema: { tags: ["Detection Dataset"], security, body: annotationInputSchema, response: { 201: genericResponseSchema, ...errors } } }, async (request, reply) => reply.code(201).send(ok(await createAnnotation(request.body))));
  app.get("/api/dataset/annotations/:annotationId/history", { schema: { tags: ["Detection Dataset"], security, params: annotationParamsSchema, response: { 200: genericResponseSchema, ...errors } } }, async (request) => ok(await listAnnotationHistory(request.params.annotationId)));
  app.patch("/api/dataset/annotations/:annotationId", { schema: { tags: ["Detection Dataset"], security, params: annotationParamsSchema, body: annotationUpdateSchema, response: { 200: genericResponseSchema, ...errors } } }, async (request) => ok(await updateAnnotation(request.params.annotationId, request.body)));
  app.post("/api/dataset/exports", { schema: { tags: ["Detection Dataset"], security, body: exportDatasetSchema, response: { 201: genericResponseSchema, ...errors } } }, async (_request, reply) => reply.code(201).send(ok(await exportDataset())));
  app.get("/api/dataset/versions", { schema: { tags: ["Detection Dataset"], security, response: { 200: genericResponseSchema, ...errors } } }, async () => ok(await listDatasetVersions()));
  app.get("/api/models/versions", { schema: { tags: ["Detection Models"], security, response: { 200: genericResponseSchema, ...errors } } }, async () => ok(await listModelVersions()));
  app.post("/api/models/versions", { schema: { tags: ["Detection Models"], security, body: modelVersionSchema, response: { 201: genericResponseSchema, ...errors } } }, async (request, reply) => reply.code(201).send(ok(await registerModelVersion(request.body))));
  app.post("/api/models/versions/:modelVersionId/approve", { schema: { tags: ["Detection Models"], security, params: z.object({ modelVersionId: z.uuid() }), body: z.object({ confirmed: z.literal(true) }), response: { 200: genericResponseSchema, ...errors } } }, async (request) => ok(await approveModelVersion(request.params.modelVersionId)));
  app.post("/api/models/versions/:modelVersionId/reject", { schema: { tags: ["Detection Models"], security, params: z.object({ modelVersionId: z.uuid() }), body: z.object({ confirmed: z.literal(true), reason: z.string().trim().min(3).max(500) }), response: { 200: genericResponseSchema, ...errors } } }, async (request) => ok(await rejectModelVersion(request.params.modelVersionId, request.body.reason)));
  app.post("/api/models/versions/:modelVersionId/activate", { schema: { tags: ["Detection Models"], security, params: z.object({ modelVersionId: z.uuid() }), body: z.object({ confirmed: z.literal(true) }), response: { 200: genericResponseSchema, ...errors } } }, async (request) => ok(await activateModelVersion(request.params.modelVersionId)));
};
