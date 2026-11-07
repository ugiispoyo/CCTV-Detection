import { env } from "../../config/env.js";
import { AppError, notFound } from "../../lib/errors.js";
import { CameraModel } from "../cameras/camera.model.js";
import { DetectionModel } from "../detections/detection.model.js";
import { IdentityVerificationModel } from "../people/identity-verification.model.js";
import { PersonModel } from "../people/person.model.js";
import { auditIdentityAction, resolveCredential } from "../people/person.service.js";
import { associateActiveIdentity } from "../people/active-identity.service.js";
import { DatasetAnnotationHistoryModel, DatasetAnnotationModel } from "../datasets/dataset.model.js";
import { PersonCaptureModel, type PersonCaptureDocument, type ReviewStatus } from "./person-capture.model.js";
import { inspectJpeg, readCaptureImage, removeCaptureImage, storeCaptureImage } from "./person-capture.storage.js";

export function serializeCapture(capture: PersonCaptureDocument) {
  return { captureId: capture.captureId, cameraId: capture.cameraId, sessionId: capture.sessionId, trackId: capture.trackId,
    crossingId: capture.crossingId ?? capture.captureId, lineId: capture.lineId ?? "legacy-line", direction: capture.direction ?? "in",
    confidence: capture.confidence, capturedAt: capture.capturedAt.toISOString(), reviewStatus: capture.reviewStatus,
    hasImage: Boolean(capture.fullBodyImagePath ?? capture.imagePath), hasFullBodyImage: Boolean(capture.fullBodyImagePath ?? capture.imagePath), hasHeadImage: Boolean(capture.headImagePath),
    ...(capture.linkedPersonId ? { linkedPersonId: capture.linkedPersonId } : {}),
    ...(capture.reviewedAt ? { reviewedAt: capture.reviewedAt.toISOString() } : {}), ...(capture.reviewedBy ? { reviewedBy: capture.reviewedBy } : {}),
    createdAt: capture.createdAt.toISOString(), updatedAt: capture.updatedAt.toISOString() };
}

type Ingest = { captureId: string; cameraId: string; sessionId: string; trackId: number; crossingId: string; lineId: string; direction: "in" | "out"; confidence: number; capturedAt: string; fullBodyImageBase64: string; headImageBase64?: string | undefined };

function decodeImage(value: string, kind: string): Buffer {
  const image = Buffer.from(value, "base64");
  if (!image.length || image.toString("base64") !== value) throw new AppError(400, "INVALID_IMAGE_ENCODING", `${kind} image encoding is invalid`);
  if (image.length > env.PERSON_CAPTURE_MAX_FILE_BYTES) throw new AppError(413, "IMAGE_TOO_LARGE", `${kind} image exceeds the configured size limit`);
  const dimensions = inspectJpeg(image);
  if (dimensions.width > env.PERSON_CAPTURE_MAX_WIDTH || dimensions.height > env.PERSON_CAPTURE_MAX_HEIGHT) throw new AppError(413, "IMAGE_DIMENSIONS_TOO_LARGE", `${kind} image dimensions exceed configured limits`);
  return image;
}

export async function ingestPersonCapture(input: Ingest) {
  const existing = await PersonCaptureModel.findOne({ captureId: input.captureId }).lean()
    ?? await PersonCaptureModel.findOne({ crossingId: input.crossingId }).lean();
  if (existing) return { capture: serializeCapture(existing), duplicate: true };
  const camera = await CameraModel.findOne({ cameraId: input.cameraId, isActive: true }).lean();
  if (!camera) throw notFound("Active camera not found");
  if (!env.PERSON_CAPTURE_LINE_IDS.includes(input.lineId)) throw new AppError(409, "UNKNOWN_COUNTING_LINE", "Referenced counting line is not configured");
  const capturedAt = new Date(input.capturedAt);
  if (capturedAt.getTime() > Date.now() + 5 * 60_000 || capturedAt.getTime() < Date.now() - 30 * 86_400_000) throw new AppError(400, "INVALID_CAPTURE_TIME", "Capture timestamp is outside the accepted window");
  const fullBodyImage = decodeImage(input.fullBodyImageBase64, "Full-body");
  const headImage = input.headImageBase64 ? decodeImage(input.headImageBase64, "Head") : undefined;
  const fullBodyImagePath = await storeCaptureImage(input.cameraId, input.captureId, "full-body", capturedAt, fullBodyImage);
  let headImagePath: string | undefined;
  try {
    if (headImage) headImagePath = await storeCaptureImage(input.cameraId, input.captureId, "head", capturedAt, headImage);
    const { fullBodyImageBase64: _fullBody, headImageBase64: _head, capturedAt: _capturedAt, ...metadata } = input;
    const created = await PersonCaptureModel.create({ ...metadata, fullBodyImagePath, ...(headImagePath ? { headImagePath } : {}), capturedAt, reviewStatus: "pending" });
    return { capture: serializeCapture(created.toObject()), duplicate: false };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const duplicate = await PersonCaptureModel.findOne({ captureId: input.captureId }).lean()
        ?? await PersonCaptureModel.findOne({ crossingId: input.crossingId }).lean();
      if (duplicate) {
        if (duplicate.captureId !== input.captureId) {
          await removeCaptureImage(fullBodyImagePath);
          if (headImagePath) await removeCaptureImage(headImagePath);
        }
        return { capture: serializeCapture(duplicate), duplicate: true };
      }
    }
    await removeCaptureImage(fullBodyImagePath);
    if (headImagePath) await removeCaptureImage(headImagePath);
    throw error;
  }
}

export async function listPersonCaptures(query: { page: number; limit: number; status?: ReviewStatus | undefined; direction?: "in" | "out" | undefined; cameraId?: string | undefined }) {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.reviewStatus = query.status;
  if (query.direction) filter.direction = query.direction;
  if (query.cameraId) filter.cameraId = query.cameraId;
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([PersonCaptureModel.find(filter).sort({ capturedAt: -1 }).skip(skip).limit(query.limit).lean(), PersonCaptureModel.countDocuments(filter)]);
  return { items: items.map(serializeCapture), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function getPersonCaptureQualityMetrics(query: { cameraId?: string | undefined; since?: string | undefined }) {
  const eventMatch: Record<string, unknown> = { objectType: "person" };
  const captureMatch: Record<string, unknown> = {};
  if (query.cameraId) { eventMatch.cameraId = query.cameraId; captureMatch.cameraId = query.cameraId; }
  if (query.since) { eventMatch.timestamp = { $gte: new Date(query.since) }; captureMatch.capturedAt = { $gte: new Date(query.since) }; }
  const [events, captures] = await Promise.all([
    DetectionModel.aggregate<{ _id: { cameraId: string; direction: "in" | "out" }; crossingEvents: number }>([
      { $match: eventMatch }, { $group: { _id: { cameraId: "$cameraId", direction: "$direction" }, crossingEvents: { $sum: 1 } } },
    ]),
    PersonCaptureModel.aggregate<{ _id: { cameraId: string; direction: "in" | "out" }; captures: number; fullBodyAvailable: number; headAvailable: number; reviewed: number; dismissed: number }>([
      { $match: captureMatch }, { $group: { _id: { cameraId: "$cameraId", direction: "$direction" }, captures: { $sum: 1 },
        fullBodyAvailable: { $sum: { $cond: [{ $or: [{ $ne: ["$fullBodyImagePath", null] }, { $ne: ["$imagePath", null] }] }, 1, 0] } },
        headAvailable: { $sum: { $cond: [{ $ne: ["$headImagePath", null] }, 1, 0] } },
        reviewed: { $sum: { $cond: [{ $eq: ["$reviewStatus", "reviewed"] }, 1, 0] } },
        dismissed: { $sum: { $cond: [{ $eq: ["$reviewStatus", "dismissed"] }, 1, 0] } } } },
    ]),
  ]);
  const keys = new Set([...events, ...captures].map((item) => `${item._id.cameraId}:${item._id.direction}`));
  const rows = [...keys].sort().map((key) => {
    const event = events.find((item) => `${item._id.cameraId}:${item._id.direction}` === key);
    const capture = captures.find((item) => `${item._id.cameraId}:${item._id.direction}` === key);
    const crossingEvents = event?.crossingEvents ?? 0;
    const captureCount = capture?.captures ?? 0;
    const [cameraId, direction] = key.split(":") as [string, "in" | "out"];
    return { cameraId, direction, crossingEvents, captures: captureCount,
      missingCaptures: Math.max(crossingEvents - captureCount, 0), captureRate: crossingEvents ? Math.min(captureCount / crossingEvents, 1) : null,
      fullBodyAvailable: capture?.fullBodyAvailable ?? 0, headAvailable: capture?.headAvailable ?? 0,
      headCropRate: captureCount ? (capture?.headAvailable ?? 0) / captureCount : null,
      reviewed: capture?.reviewed ?? 0, dismissed: capture?.dismissed ?? 0 };
  });
  return { generatedAt: new Date().toISOString(), since: query.since ?? null, rows,
    limitations: "Historical events before capture rollout and expired retained images affect rates. Missed detections require a separately annotated evaluation video and cannot be inferred from event records." };
}
export async function getPersonCapture(captureId: string) { const capture = await PersonCaptureModel.findOne({ captureId }).lean(); if (!capture) throw notFound("Person capture not found"); return serializeCapture(capture); }
export async function getPersonCaptureImage(captureId: string, kind: "full-body" | "head" = "full-body") { const capture = await PersonCaptureModel.findOne({ captureId }).lean(); if (!capture) throw notFound("Person capture not found"); const path = kind === "head" ? capture.headImagePath : (capture.fullBodyImagePath ?? capture.imagePath); if (!path) throw new AppError(410, "IMAGE_EXPIRED", `${kind} capture image is unavailable`); return readCaptureImage(path); }

export async function reviewPersonCapture(captureId: string, action: "dismiss" | "reopen") {
  const update = action === "dismiss" ? { reviewStatus: "dismissed", reviewedAt: new Date(), reviewedBy: env.OPERATOR_ID, $unset: { linkedPersonId: 1 } } : { reviewStatus: "pending", $unset: { reviewedAt: 1, reviewedBy: 1, linkedPersonId: 1 } };
  const capture = await PersonCaptureModel.findOneAndUpdate({ captureId }, update, { new: true }).lean();
  if (!capture) throw notFound("Person capture not found");
  await auditIdentityAction(`capture.${action}`, { captureId });
  return serializeCapture(capture);
}

export async function deletePendingPersonCapture(captureId: string) {
  const session = await PersonCaptureModel.startSession();
  const imagePaths: string[] = [];
  let deletedAnnotations = 0;
  try {
    await session.withTransaction(async () => {
      const capture = await PersonCaptureModel.findOne({ captureId }).session(session);
      if (!capture) throw notFound("Person capture not found");
      if (!(["pending", "dismissed"] as ReviewStatus[]).includes(capture.reviewStatus) || capture.linkedPersonId) {
        throw new AppError(409, "CAPTURE_DELETE_NOT_ALLOWED", "Only a pending or dismissed capture without a linked person can be deleted");
      }
      const annotations = await DatasetAnnotationModel.find({ captureId }).session(session);
      if (annotations.some((annotation) => annotation.status === "approved")) {
        throw new AppError(409, "CAPTURE_HAS_APPROVED_ANNOTATION", "A capture with an approved dataset annotation cannot be deleted");
      }
      for (const annotation of annotations) {
        await DatasetAnnotationHistoryModel.deleteMany({ annotationId: annotation.annotationId }).session(session);
      }
      const deletion = await DatasetAnnotationModel.deleteMany({ captureId }).session(session);
      deletedAnnotations = deletion.deletedCount;
      imagePaths.push(...new Set([capture.fullBodyImagePath, capture.headImagePath, capture.imagePath].filter((value): value is string => Boolean(value))));
      await capture.deleteOne({ session });
      await auditIdentityAction("capture.deleted", { captureId, details: { cameraId: capture.cameraId, direction: capture.direction ?? "unknown", deletedAnnotations } }, session);
    });
  } finally {
    await session.endSession();
  }
  for (const path of imagePaths) await removeCaptureImage(path);
  return { captureId, deleted: true as const, deletedImages: imagePaths.length, deletedAnnotations };
}

async function persistCaptureVerification(captureId: string, personId: string, method: "manual" | "credential") {
  const verificationId = crypto.randomUUID();
  const session = await PersonCaptureModel.startSession();
  let serialized: ReturnType<typeof serializeCapture> | undefined;
  let activeIdentity: ReturnType<typeof associateActiveIdentity>;
  let associationInput: { capture: { cameraId: string; sessionId: string; trackId: number }; person: { personId: string; fullName: string } } | undefined;
  try {
    await session.withTransaction(async () => {
      // MongoDB transactions do not support parallel operations on one session.
      // Running these through Promise.all can advance the transaction number
      // concurrently and fail with ConflictingOperationInProgress.
      const capture = await PersonCaptureModel.findOne({ captureId }).session(session);
      const person = await PersonModel.findOne({ personId, isActive: true }).session(session);
      if (!capture) throw notFound("Person capture not found"); if (!person) throw notFound("Active registered person not found");
      capture.reviewStatus = "reviewed"; capture.linkedPersonId = personId; capture.reviewedAt = new Date(); capture.reviewedBy = env.OPERATOR_ID;
      await capture.save({ session });
      await IdentityVerificationModel.create([{ verificationId, personId, captureId, method, verifiedAt: new Date(), verifiedBy: env.OPERATOR_ID, cameraId: capture.cameraId }], { session });
      await auditIdentityAction(method === "manual" ? "capture.manually_verified" : "capture.credential_verified", { captureId, personId, details: { verificationId } }, session);
      serialized = serializeCapture(capture.toObject());
      associationInput = { capture: { cameraId: capture.cameraId, sessionId: capture.sessionId, trackId: capture.trackId }, person: { personId: person.personId, fullName: person.fullName } };
    });
  } finally { await session.endSession(); }
  if (!serialized) throw new AppError(500, "VERIFICATION_FAILED", "Identity verification transaction did not commit");
  if (associationInput) activeIdentity = associateActiveIdentity(associationInput.capture, associationInput.person, method);
  return { capture: serialized, verificationId, ...(activeIdentity ? { activeIdentity } : {}) };
}

export async function verifyPersonCapture(captureId: string, personId: string) {
  return persistCaptureVerification(captureId, personId, "manual");
}

export async function verifyPersonCaptureCredential(captureId: string, credential: string) {
  if (!await PersonCaptureModel.exists({ captureId })) throw notFound("Person capture not found");
  const person = await resolveCredential(credential);
  return persistCaptureVerification(captureId, person.personId, "credential");
}

export async function enforcePersonCaptureRetention() {
  const now = Date.now();
  // Filter a bounded batch in application code because global Mongoose sanitizeFilter
  // deliberately rejects operator objects; no client-controlled query reaches MongoDB.
  const records = await PersonCaptureModel.find({}).sort({ capturedAt: 1 }).limit(2000);
  const candidates = records.filter((capture) => {
    if (!capture.fullBodyImagePath && !capture.headImagePath && !capture.imagePath) return false;
    const days = capture.reviewStatus === "pending" ? env.PERSON_CAPTURE_RETENTION_DAYS : env.PERSON_CAPTURE_REVIEWED_RETENTION_DAYS;
    return capture.capturedAt.getTime() < now - days * 86_400_000;
  }).slice(0, 500);
  for (const capture of candidates) {
    for (const path of new Set([capture.fullBodyImagePath, capture.headImagePath, capture.imagePath].filter((value): value is string => Boolean(value)))) await removeCaptureImage(path);
    await PersonCaptureModel.updateOne({ _id: capture._id }, { $unset: { imagePath: 1, fullBodyImagePath: 1, headImagePath: 1 }, $set: { imageDeletedAt: new Date() } });
  }
  return candidates.length;
}

export async function ensurePersonCaptureIndexes() {
  const indexes = await PersonCaptureModel.collection.indexes();
  const obsolete = indexes.filter((index) => index.unique && (
    JSON.stringify(index.key) === JSON.stringify({ cameraId: 1, sessionId: 1, trackId: 1 }) ||
    JSON.stringify(index.key) === JSON.stringify({ cameraId: 1, sessionId: 1, trackId: 1, lineId: 1 })
  ));
  for (const index of obsolete) if (index.name) await PersonCaptureModel.collection.dropIndex(index.name);
  await PersonCaptureModel.createIndexes();
}
