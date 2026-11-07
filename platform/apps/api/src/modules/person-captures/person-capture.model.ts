import { Schema, model } from "mongoose";

export type ReviewStatus = "pending" | "reviewed" | "dismissed";
export interface PersonCaptureDocument {
  captureId: string; cameraId: string; sessionId: string; trackId: number; crossingId?: string; confidence: number;
  lineId?: string; direction?: "in" | "out";
  imagePath?: string; fullBodyImagePath?: string; headImagePath?: string; imageDeletedAt?: Date; capturedAt: Date; reviewStatus: ReviewStatus;
  linkedPersonId?: string; reviewedAt?: Date; reviewedBy?: string; createdAt: Date; updatedAt: Date;
}

const schema = new Schema<PersonCaptureDocument>({
  captureId: { type: String, required: true, unique: true, immutable: true },
  cameraId: { type: String, required: true, immutable: true, maxlength: 80 },
  sessionId: { type: String, required: true, immutable: true, maxlength: 100 },
  trackId: { type: Number, required: true, immutable: true, min: 0 },
  crossingId: { type: String, immutable: true, maxlength: 100 },
  lineId: { type: String, immutable: true, maxlength: 80 },
  direction: { type: String, immutable: true, enum: ["in", "out"] },
  confidence: { type: Number, required: true, min: 0, max: 1 },
  imagePath: { type: String, maxlength: 500 },
  fullBodyImagePath: { type: String, maxlength: 500 }, headImagePath: { type: String, maxlength: 500 }, imageDeletedAt: Date,
  capturedAt: { type: Date, required: true },
  reviewStatus: { type: String, enum: ["pending", "reviewed", "dismissed"], default: "pending" },
  linkedPersonId: { type: String, maxlength: 80 }, reviewedAt: Date, reviewedBy: { type: String, maxlength: 80 },
}, { timestamps: true, collection: "person_captures", versionKey: false });
schema.index({ crossingId: 1 }, { unique: true, sparse: true, name: "capture_crossing_event" });
schema.index({ cameraId: 1, sessionId: 1, trackId: 1, lineId: 1 }, { name: "capture_track_line_history" });
schema.index({ reviewStatus: 1, capturedAt: -1 });
schema.index({ direction: 1, reviewStatus: 1, capturedAt: -1 });
schema.index({ cameraId: 1, capturedAt: -1 });
schema.index({ linkedPersonId: 1 }, { sparse: true });
export const PersonCaptureModel = model<PersonCaptureDocument>("PersonCapture", schema);
