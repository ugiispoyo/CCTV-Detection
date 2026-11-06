import { Schema, model } from "mongoose";

export interface DetectionDocument {
  eventId: string;
  cameraId: string;
  sessionId: string;
  trackId: number;
  objectType: "person" | "car" | "motorcycle";
  eventType: "line_crossing";
  direction: "in" | "out";
  confidence?: number;
  timestamp: Date;
  createdAt: Date;
}

const detectionSchema = new Schema<DetectionDocument>(
  {
    eventId: { type: String, required: true, unique: true, immutable: true, maxlength: 100 },
    cameraId: { type: String, required: true, immutable: true, maxlength: 80 },
    sessionId: { type: String, required: true, immutable: true, maxlength: 100 },
    trackId: { type: Number, required: true, immutable: true, min: 0 },
    objectType: { type: String, required: true, enum: ["person", "car", "motorcycle"], immutable: true },
    eventType: { type: String, required: true, enum: ["line_crossing"], immutable: true },
    direction: { type: String, required: true, enum: ["in", "out"], immutable: true },
    confidence: { type: Number, min: 0, max: 1, immutable: true },
    timestamp: { type: Date, required: true, immutable: true },
    createdAt: { type: Date, default: Date.now, immutable: true },
  },
  { collection: "detection_events", versionKey: false },
);

detectionSchema.index({ cameraId: 1, timestamp: -1 });
detectionSchema.index({ objectType: 1, timestamp: -1 });
detectionSchema.index({ cameraId: 1, objectType: 1, direction: 1, timestamp: -1 });

export const DetectionModel = model<DetectionDocument>("DetectionEvent", detectionSchema);
