import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "../../config/env.js";
import { AppError, notFound } from "../../lib/errors.js";
import { PersonCaptureModel } from "../person-captures/person-capture.model.js";
import { readCaptureImage } from "../person-captures/person-capture.storage.js";
import { DATASET_CLASSES, DatasetAnnotationHistoryModel, DatasetAnnotationModel, DatasetVersionModel, DetectionModelVersionModel, type DatasetClass } from "./dataset.model.js";

const classMapping = Object.fromEntries(DATASET_CLASSES.map((name, index) => [name, index])) as Record<DatasetClass, number>;
type AnnotationInput = { captureId: string; imageKind: "full-body" | "head"; className: DatasetClass; xCenter: number; yCenter: number; width: number; height: number };
type DatasetCaptureSource = { captureId: string; cameraId: string; sessionId: string; direction?: "in" | "out"; capturedAt: Date; fullBodyImagePath?: string; imagePath?: string; headImagePath?: string };

function annotationFingerprint(input: AnnotationInput): string {
  const canonical = [input.captureId, input.imageKind, input.className,
    input.xCenter.toFixed(6), input.yCenter.toFixed(6), input.width.toFixed(6), input.height.toFixed(6)];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function recordAnnotationHistory(annotationId: string, action: "created" | "updated" | "approved" | "rejected", before: unknown, after: unknown) {
  await DatasetAnnotationHistoryModel.create({ historyId: crypto.randomUUID(), annotationId, action, before, after, actor: env.OPERATOR_ID, occurredAt: new Date() });
}

export async function createAnnotation(input: AnnotationInput) {
  const capture = await PersonCaptureModel.findOne({ captureId: input.captureId }).lean();
  if (!capture) throw notFound("Capture not found");
  if (input.imageKind === "head" && !capture.headImagePath) throw new AppError(409, "HEAD_IMAGE_UNAVAILABLE", "Head image is unavailable for annotation");
  const duplicate = await DatasetAnnotationModel.findOne(input).lean();
  if (duplicate) throw new AppError(409, "DUPLICATE_ANNOTATION", "An identical annotation already exists for this image");
  const annotation = new DatasetAnnotationModel({ ...input, fingerprint: annotationFingerprint(input), annotationId: crypto.randomUUID(), classId: classMapping[input.className], status: "draft", createdBy: env.OPERATOR_ID });
  try {
    await annotation.save();
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new AppError(409, "DUPLICATE_ANNOTATION", "An identical annotation already exists for this image");
    throw error;
  }
  const result = annotation.toObject();
  await recordAnnotationHistory(annotation.annotationId, "created", undefined, result);
  return result;
}

export async function listAnnotations(captureId?: string) {
  return DatasetAnnotationModel.find(captureId ? { captureId } : {}).sort({ createdAt: -1 }).limit(1000).lean();
}

export async function listAnnotationHistory(annotationId: string) {
  if (!await DatasetAnnotationModel.exists({ annotationId })) throw notFound("Dataset annotation not found");
  return DatasetAnnotationHistoryModel.find({ annotationId }).sort({ occurredAt: 1 }).limit(500).lean();
}

export async function updateAnnotation(annotationId: string, input: Record<string, unknown>) {
  const annotation = await DatasetAnnotationModel.findOne({ annotationId });
  if (!annotation) throw notFound("Dataset annotation not found");
  const before = annotation.toObject();
  annotation.set(input);
  const className = annotation.className as DatasetClass;
  annotation.classId = classMapping[className];
  annotation.fingerprint = annotationFingerprint({ captureId: annotation.captureId, imageKind: annotation.imageKind, className,
    xCenter: annotation.xCenter, yCenter: annotation.yCenter, width: annotation.width, height: annotation.height });
  const duplicate = await DatasetAnnotationModel.findOne({ captureId: annotation.captureId, imageKind: annotation.imageKind, className,
    xCenter: annotation.xCenter, yCenter: annotation.yCenter, width: annotation.width, height: annotation.height }).lean();
  if (duplicate && duplicate.annotationId !== annotationId) throw new AppError(409, "DUPLICATE_ANNOTATION", "An identical annotation already exists for this image");
  if (annotation.status === "approved") { annotation.approvedAt = new Date(); annotation.approvedBy = env.OPERATOR_ID; }
  else { annotation.approvedAt = null; annotation.approvedBy = null; }
  try {
    await annotation.save();
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new AppError(409, "DUPLICATE_ANNOTATION", "An identical annotation already exists for this image");
    throw error;
  }
  const after = annotation.toObject();
  const action = input.status === "approved" ? "approved" : input.status === "rejected" ? "rejected" : "updated";
  await recordAnnotationHistory(annotationId, action, before, after);
  return after;
}

export async function exportDataset() {
  const annotations = await DatasetAnnotationModel.find({ status: "approved" }).sort({ captureId: 1, imageKind: 1 }).lean();
  if (!annotations.length) throw new AppError(409, "NO_APPROVED_ANNOTATIONS", "No approved annotations are available");
  const latest = await DatasetVersionModel.findOne({}).sort({ versionNumber: -1 }).lean();
  const versionNumber = (latest?.versionNumber ?? 0) + 1;
  const versionId = `v${versionNumber}`;
  const root = resolve(env.DATASET_EXPORT_DIR, "vehicle-person-detector", versionId);
  const groups = new Map<string, typeof annotations>();
  for (const annotation of annotations) {
    const group = groups.get(`${annotation.captureId}:${annotation.imageKind}`) ?? [];
    group.push(annotation); groups.set(`${annotation.captureId}:${annotation.imageKind}`, group);
  }
  const captureById = new Map<string, DatasetCaptureSource | null>();
  for (const groupKey of groups.keys()) {
    const captureId = groupKey.split(":")[0]!;
    if (!captureById.has(captureId)) captureById.set(captureId, await PersonCaptureModel.findOne({ captureId }).lean<DatasetCaptureSource>());
  }
  const captureSources = [...captureById.values()].filter((capture): capture is DatasetCaptureSource => capture !== null);
  const sessionKeys = [...new Set(captureSources.map((capture) => `${capture.cameraId}:${capture.sessionId}`))].sort();
  const validationSessions = new Set(sessionKeys.filter((key) => Number.parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) % 5 === 0));
  if (sessionKeys.length > 1 && validationSessions.size === 0) validationSessions.add(sessionKeys.at(-1)!);
  const sessionGrouped = sessionKeys.length > 1;
  for (const split of ["train", "val"]) {
    await mkdir(resolve(root, "images", split), { recursive: true, mode: 0o700 });
    await mkdir(resolve(root, "labels", split), { recursive: true, mode: 0o700 });
  }
  for (const [groupKey, group] of groups) {
    const [captureId, imageKind] = groupKey.split(":") as [string, "full-body" | "head"];
    const capture = captureById.get(captureId);
    const imagePath = imageKind === "head" ? capture?.headImagePath : (capture?.fullBodyImagePath ?? capture?.imagePath);
    if (!capture || !imagePath) throw new AppError(409, "SOURCE_IMAGE_UNAVAILABLE", `Approved source image is unavailable for capture ${captureId}`);
    const sessionKey = `${capture.cameraId}:${capture.sessionId}`;
    const split = sessionGrouped
      ? (validationSessions.has(sessionKey) ? "val" : "train")
      : (Number.parseInt(createHash("sha256").update(captureId).digest("hex").slice(0, 8), 16) % 10 < 8 ? "train" : "val");
    const fileName = `${captureId}-${imageKind}`;
    await writeFile(resolve(root, "images", split, `${fileName}.jpg`), await readCaptureImage(imagePath), { mode: 0o600 });
    await writeFile(resolve(root, "labels", split, `${fileName}.txt`), `${group.map((item) => `${item.classId} ${item.xCenter} ${item.yCenter} ${item.width} ${item.height}`).join("\n")}\n`, { mode: 0o600 });
  }
  await writeFile(resolve(root, "data.yaml"), `path: ${root}\ntrain: images/train\nval: images/val\nnames:\n${DATASET_CLASSES.map((name, index) => `  ${index}: ${name}`).join("\n")}\n`, { mode: 0o600 });
  const cameraCounts = Object.fromEntries([...new Set(captureSources.map((capture) => capture.cameraId))].sort().map((cameraId) => [cameraId, captureSources.filter((capture) => capture.cameraId === cameraId).length]));
  const directionCounts = { in: captureSources.filter((capture) => capture.direction === "in").length, out: captureSources.filter((capture) => capture.direction === "out").length };
  const captureTimes = captureSources.map((capture) => capture.capturedAt).filter(Boolean).map((value) => new Date(value).getTime()).sort((a, b) => a - b);
  const provenance = { cameraCounts, directionCounts, captureTimeRange: captureTimes.length ? { first: new Date(captureTimes[0]!).toISOString(), last: new Date(captureTimes.at(-1)!).toISOString() } : null };
  const metadata = { versionId, versionNumber, createdAt: new Date().toISOString(), createdBy: env.OPERATOR_ID, annotationCount: annotations.length, imageCount: groups.size, classMapping, privacy: "No resident identity attributes are exported", splitStrategy: sessionGrouped ? "camera and tracking-session grouped deterministic split" : "capture-id grouped deterministic 80/20 fallback (only one tracking session available)", trackingSessionCount: sessionKeys.length, provenance };
  await writeFile(resolve(root, "metadata.json"), JSON.stringify(metadata, null, 2), { mode: 0o600 });
  await DatasetVersionModel.create({ ...metadata, exportPath: root, status: "exported" });
  return metadata;
}

export async function listDatasetVersions() { return DatasetVersionModel.find({}).sort({ versionNumber: -1 }).lean(); }
export async function registerModelVersion(input: { datasetVersionId: string; modelPath: string; parameters: Record<string, unknown>; metrics: Record<string, unknown> }) {
  if (!env.DATASET_TRAINING_ENABLED) throw new AppError(503, "TRAINING_REGISTRY_DISABLED", "Dataset training registry is disabled");
  if (!await DatasetVersionModel.exists({ versionId: input.datasetVersionId })) throw notFound("Dataset version not found");
  return (await DetectionModelVersionModel.create({ ...input, modelVersionId: crypto.randomUUID(), status: "candidate", createdAt: new Date() })).toObject();
}
export async function listModelVersions() { return DetectionModelVersionModel.find({}).sort({ createdAt: -1 }).lean(); }
export async function approveModelVersion(modelVersionId: string) {
  const model = await DetectionModelVersionModel.findOneAndUpdate({ modelVersionId, status: "candidate" }, { status: "approved", approvedAt: new Date(), approvedBy: env.OPERATOR_ID }, { new: true }).lean();
  if (!model) throw notFound("Candidate model version not found");
  return model;
}
export async function rejectModelVersion(modelVersionId: string, reason: string) {
  const model = await DetectionModelVersionModel.findOneAndUpdate({ modelVersionId, status: "candidate" }, { status: "rejected", rejectedAt: new Date(), rejectedBy: env.OPERATOR_ID, rejectionReason: reason }, { new: true }).lean();
  if (!model) throw notFound("Candidate model version not found");
  return model;
}
export async function activateModelVersion(modelVersionId: string) {
  const models = await DetectionModelVersionModel.find({});
  const target = models.find((model) => model.modelVersionId === modelVersionId && ["approved", "retired"].includes(model.status));
  if (!target) throw notFound("Approved or previously active model version not found");
  for (const model of models) if (model.status === "active" && model.modelVersionId !== modelVersionId) { model.status = "retired"; await model.save(); }
  target.status = "active";
  await target.save();
  return { ...target.toObject(), deploymentRequired: true, message: "Registry updated. Change MODEL_PATH and restart CV explicitly; no model file was overwritten." };
}

export async function ensureDatasetIndexes() {
  await Promise.all([DatasetAnnotationModel.createIndexes(), DatasetAnnotationHistoryModel.createIndexes(), DatasetVersionModel.createIndexes(), DetectionModelVersionModel.createIndexes()]);
}
