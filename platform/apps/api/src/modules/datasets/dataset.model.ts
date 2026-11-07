import { Schema, model } from "mongoose";

export const DATASET_CLASSES = ["person", "head", "car", "motorcycle"] as const;
export type DatasetClass = typeof DATASET_CLASSES[number];

const annotationSchema = new Schema({
  annotationId: { type: String, required: true, unique: true }, captureId: { type: String, required: true, index: true },
  fingerprint: { type: String, maxlength: 64 },
  imageKind: { type: String, required: true, enum: ["full-body", "head"] },
  className: { type: String, required: true, enum: DATASET_CLASSES }, classId: { type: Number, required: true, min: 0, max: 3 },
  xCenter: { type: Number, required: true, min: 0, max: 1 }, yCenter: { type: Number, required: true, min: 0, max: 1 },
  width: { type: Number, required: true, min: 0.000001, max: 1 }, height: { type: Number, required: true, min: 0.000001, max: 1 },
  status: { type: String, required: true, enum: ["draft", "approved", "rejected"], default: "draft" },
  approvedBy: String, approvedAt: Date, createdBy: { type: String, required: true },
}, { timestamps: true, collection: "dataset_annotations", versionKey: false });
annotationSchema.index({ captureId: 1, imageKind: 1, status: 1 });
annotationSchema.index({ fingerprint: 1 }, { unique: true, sparse: true, name: "unique_dataset_annotation" });
export const DatasetAnnotationModel = model("DatasetAnnotation", annotationSchema);

const annotationHistorySchema = new Schema({
  historyId: { type: String, required: true, unique: true }, annotationId: { type: String, required: true, index: true },
  action: { type: String, required: true, enum: ["created", "updated", "approved", "rejected"] },
  before: Schema.Types.Mixed, after: { type: Schema.Types.Mixed, required: true },
  actor: { type: String, required: true }, occurredAt: { type: Date, required: true },
}, { collection: "dataset_annotation_history", versionKey: false });
annotationHistorySchema.index({ annotationId: 1, occurredAt: -1 });
export const DatasetAnnotationHistoryModel = model("DatasetAnnotationHistory", annotationHistorySchema);

const versionSchema = new Schema({
  versionId: { type: String, required: true, unique: true }, versionNumber: { type: Number, required: true, unique: true },
  status: { type: String, enum: ["exported", "training", "evaluated", "approved", "archived"], default: "exported" },
  exportPath: { type: String, required: true }, annotationCount: { type: Number, required: true }, imageCount: { type: Number, required: true },
  classMapping: { type: Schema.Types.Mixed, required: true }, createdBy: { type: String, required: true }, createdAt: { type: Date, required: true },
  splitStrategy: String, trackingSessionCount: Number, provenance: Schema.Types.Mixed, privacy: String,
  trainingParameters: Schema.Types.Mixed, metrics: Schema.Types.Mixed, modelPath: String, approvedAt: Date, approvedBy: String,
}, { collection: "detection_dataset_versions", versionKey: false });
export const DatasetVersionModel = model("DatasetVersion", versionSchema);

const modelVersionSchema = new Schema({
  modelVersionId: { type: String, required: true, unique: true }, datasetVersionId: { type: String, required: true },
  modelPath: { type: String, required: true }, status: { type: String, enum: ["candidate", "approved", "active", "retired", "rejected"], default: "candidate" },
  parameters: Schema.Types.Mixed, metrics: Schema.Types.Mixed, createdAt: { type: Date, required: true }, approvedAt: Date, approvedBy: String, rejectedAt: Date, rejectedBy: String, rejectionReason: String,
}, { collection: "detection_model_versions", versionKey: false });
export const DetectionModelVersionModel = model("DetectionModelVersion", modelVersionSchema);
