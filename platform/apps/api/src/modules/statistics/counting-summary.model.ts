import { Schema, model } from "mongoose";

export interface CountingSummaryDocument {
  cameraId: string;
  objectType: "person" | "car" | "motorcycle";
  direction: "in" | "out";
  periodStart: Date;
  periodType: "hour";
  count: number;
  updatedAt: Date;
}

const countingSummarySchema = new Schema<CountingSummaryDocument>(
  {
    cameraId: { type: String, required: true, maxlength: 80 },
    objectType: { type: String, required: true, enum: ["person", "car", "motorcycle"] },
    direction: { type: String, required: true, enum: ["in", "out"] },
    periodStart: { type: Date, required: true },
    periodType: { type: String, required: true, enum: ["hour"], default: "hour" },
    count: { type: Number, required: true, min: 0, default: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "counting_summaries", versionKey: false },
);

countingSummarySchema.index(
  { cameraId: 1, objectType: 1, direction: 1, periodType: 1, periodStart: 1 },
  { unique: true, name: "unique_hourly_summary" },
);
countingSummarySchema.index({ periodStart: 1, cameraId: 1 });

export const CountingSummaryModel = model<CountingSummaryDocument>("CountingSummary", countingSummarySchema);
