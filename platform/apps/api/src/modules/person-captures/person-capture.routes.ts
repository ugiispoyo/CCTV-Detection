import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { errorResponseSchema, ok, successSchema } from "../../lib/schemas.js";
import { captureDtoSchema, captureListQuerySchema, captureListResponseSchema, captureParamsSchema, captureQualityQuerySchema, captureResponseSchema, deleteCaptureSchema, reviewCaptureSchema, verifyCaptureSchema } from "./person-capture.schema.js";
import { deletePendingPersonCapture, getPersonCapture, getPersonCaptureImage, getPersonCaptureQualityMetrics, listPersonCaptures, reviewPersonCapture, verifyPersonCapture, verifyPersonCaptureCredential } from "./person-capture.service.js";
import { requireOperator } from "../../plugins/operator-auth.js";
const errors = { 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 410: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema };
const security = [{ operatorAuth: [] }];
export const personCaptureRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("onRequest", requireOperator);
  app.get("/api/person-captures", { schema: { tags: ["Person Captures"], summary: "List protected person captures", security, querystring: captureListQuerySchema, response: { 200: captureListResponseSchema, ...errors } } }, async (request) => ok(await listPersonCaptures(request.query)));
  app.get("/api/person-captures/quality-metrics", { schema: { tags: ["Person Captures"], summary: "Measure crossing-to-capture and crop quality per camera/direction", security, querystring: captureQualityQuerySchema, response: { 200: successSchema(z.unknown()), ...errors } } }, async (request) => ok(await getPersonCaptureQualityMetrics(request.query)));
  app.get("/api/person-captures/:captureId", { schema: { tags: ["Person Captures"], summary: "Get protected capture metadata", security, params: captureParamsSchema, response: { 200: captureResponseSchema, ...errors } } }, async (request) => ok(await getPersonCapture(request.params.captureId)));
  const imageHandler = (kind: "full-body" | "head") => async (request: { params: { captureId: string } }, reply: { header: (name: string, value: string) => unknown; type: (value: string) => { send: (body: Buffer) => unknown } }) => { reply.header("Cache-Control", "private, no-store"); return reply.type("image/jpeg").send(await getPersonCaptureImage(request.params.captureId, kind)); };
  app.get("/api/person-captures/:captureId/image", { schema: { tags: ["Person Captures"], summary: "Read full-body image (compatibility alias)", security, params: captureParamsSchema } }, imageHandler("full-body"));
  app.get("/api/person-captures/:captureId/images/full-body", { schema: { tags: ["Person Captures"], summary: "Read protected full-body image", security, params: captureParamsSchema } }, imageHandler("full-body"));
  app.get("/api/person-captures/:captureId/images/head", { schema: { tags: ["Person Captures"], summary: "Read protected head image", security, params: captureParamsSchema } }, imageHandler("head"));
  app.patch("/api/person-captures/:captureId/review", { schema: { tags: ["Person Captures"], summary: "Dismiss or reopen a capture", security, params: captureParamsSchema, body: reviewCaptureSchema, response: { 200: captureResponseSchema, ...errors } } }, async (request) => ok(await reviewPersonCapture(request.params.captureId, request.body.action)));
  app.delete("/api/person-captures/:captureId", { schema: { tags: ["Person Captures"], summary: "Permanently delete a pending or dismissed capture and its private images", security, params: captureParamsSchema, body: deleteCaptureSchema, response: { 200: successSchema(z.object({ captureId: z.string(), deleted: z.literal(true), deletedImages: z.number(), deletedAnnotations: z.number() })), ...errors } } }, async (request) => ok(await deletePendingPersonCapture(request.params.captureId)));
  app.post("/api/person-captures/:captureId/verify", { schema: { tags: ["Person Captures"], summary: "Explicitly link a capture to a registered person", security, params: captureParamsSchema, body: verifyCaptureSchema, response: { 200: successSchema(z.object({ capture: captureDtoSchema, verificationId: z.string(), activeIdentity: z.object({ cameraId: z.string(), sessionId: z.string(), trackId: z.number(), personId: z.string(), fullName: z.string(), verifiedAt: z.string(), expiresAt: z.string(), method: z.enum(["manual", "credential"]) }).optional() })), ...errors } } }, async (request) => {
    const result = await verifyPersonCapture(request.params.captureId, request.body.personId);
    if (result.activeIdentity) app.realtime.publish({ type: "identity.verified", data: result.activeIdentity }, { operatorOnly: true });
    return ok(result);
  });
  app.post("/api/person-captures/:captureId/verify-credential", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { tags: ["Person Captures"], summary: "Link a new crossing using a revocable non-biometric credential", security, params: captureParamsSchema, body: z.object({ credential: z.string().min(32).max(512), confirmed: z.literal(true) }), response: { 200: successSchema(z.unknown()), ...errors } } }, async (request) => {
    const result = await verifyPersonCaptureCredential(request.params.captureId, request.body.credential);
    if (result.activeIdentity) app.realtime.publish({ type: "identity.verified", data: result.activeIdentity }, { operatorOnly: true });
    return ok(result);
  });
};
