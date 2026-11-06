import type { Camera, DetectionEvent, PaginatedData, TimelinePoint } from "@cctv-ai/shared";
import { api, getData } from "./api";

export interface DetectionRecord extends DetectionEvent { createdAt: string }
export interface StatisticsSummary {
  startDate: string; endDate: string; timezone: string; totalEvents: number;
  buckets: Array<{ objectType: "person" | "car" | "motorcycle"; direction: "in" | "out"; count: number }>;
}
export interface TimelineData { startDate: string; endDate: string; timezone: string; items: TimelinePoint[] }

export const fetchCameras = (params: Record<string, unknown> = {}) => getData<PaginatedData<Camera>>("/api/cameras", params);
export const fetchDetections = (params: Record<string, unknown> = {}) => getData<PaginatedData<DetectionRecord>>("/api/detections", params);
export const fetchSummary = (params: Record<string, unknown> = {}) => getData<StatisticsSummary>("/api/statistics/summary", params);
export const fetchCameraSummary = (cameraId: string, params: Record<string, unknown> = {}) => getData<StatisticsSummary & { cameraId: string }>(`/api/statistics/cameras/${encodeURIComponent(cameraId)}`, params);
export const fetchTimeline = (params: Record<string, unknown> = {}) => getData<TimelineData>("/api/statistics/timeline", params);

export async function createCamera(input: { cameraId: string; name: string; location?: string; description?: string; physicalCameraId?: string; lensName?: string; isActive?: boolean }) {
  await api.post("/api/cameras", input);
}
export async function updateCamera(cameraId: string, input: { name?: string; location?: string | null; description?: string | null; physicalCameraId?: string | null; lensName?: string | null; isActive?: boolean }) {
  await api.patch(`/api/cameras/${encodeURIComponent(cameraId)}`, input);
}
export async function deactivateCamera(cameraId: string) { await api.delete(`/api/cameras/${encodeURIComponent(cameraId)}`); }
