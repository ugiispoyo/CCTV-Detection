import { env } from "../../config/env.js";
import { notFound } from "../../lib/errors.js";
import { resolveTimeRange, type RangeInput } from "../../lib/time-range.js";
import { CameraModel } from "../cameras/camera.model.js";
import { CountingSummaryModel } from "./counting-summary.model.js";

interface AggregateBucket { _id: { objectType: "person" | "car" | "motorcycle"; direction: "in" | "out" }; count: number }
interface TimelineBucket extends AggregateBucket { _id: AggregateBucket["_id"] & { periodStart: Date; cameraId?: string } }

function rangeMatch(start: Date, end: Date, cameraId?: string) {
  return { periodStart: { $gte: start, $lt: end }, periodType: "hour", ...(cameraId ? { cameraId } : {}) };
}

export async function getSummary(input: RangeInput, cameraId?: string) {
  if (cameraId && !(await CameraModel.exists({ cameraId }))) throw notFound("Camera not found");
  const { start, end, timezone } = resolveTimeRange(input, env.REPORT_TIMEZONE);
  const rows = await CountingSummaryModel.aggregate<AggregateBucket>([
    { $match: rangeMatch(start, end, cameraId) },
    { $group: { _id: { objectType: "$objectType", direction: "$direction" }, count: { $sum: "$count" } } },
    { $sort: { "_id.objectType": 1, "_id.direction": 1 } },
  ]);
  const buckets = rows.map((row) => ({ objectType: row._id.objectType, direction: row._id.direction, count: row.count }));
  return {
    startDate: start.toISOString(), endDate: end.toISOString(), timezone,
    totalEvents: buckets.reduce((total, bucket) => total + bucket.count, 0), buckets,
  };
}

export async function getTimeline(input: RangeInput & { cameraId?: string | undefined }) {
  const { start, end, timezone } = resolveTimeRange(input, env.REPORT_TIMEZONE);
  const includeCamera = !input.cameraId;
  const rows = await CountingSummaryModel.aggregate<TimelineBucket>([
    { $match: rangeMatch(start, end, input.cameraId) },
    { $group: { _id: { periodStart: "$periodStart", objectType: "$objectType", direction: "$direction", ...(includeCamera ? { cameraId: "$cameraId" } : {}) }, count: { $sum: "$count" } } },
    { $sort: { "_id.periodStart": 1 } },
  ]);
  return {
    startDate: start.toISOString(), endDate: end.toISOString(), timezone,
    items: rows.map((row) => ({
      periodStart: row._id.periodStart.toISOString(), objectType: row._id.objectType, direction: row._id.direction,
      count: row.count, ...(row._id.cameraId ? { cameraId: row._id.cameraId } : {}),
    })),
  };
}
