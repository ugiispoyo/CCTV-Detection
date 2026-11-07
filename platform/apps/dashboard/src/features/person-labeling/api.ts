import type { ApiSuccess } from "@cctv-ai/shared";
import { api } from "../../lib/api";

export type CaptureStatus = "pending" | "reviewed" | "dismissed";
export interface PersonCapture { captureId: string; cameraId: string; sessionId: string; trackId: number; crossingId: string; lineId: string; direction: "in" | "out"; confidence: number; capturedAt: string; reviewStatus: CaptureStatus; hasImage: boolean; hasFullBodyImage: boolean; hasHeadImage: boolean; linkedPersonId?: string; reviewedAt?: string; }
export interface RegisteredPerson { personId: string; fullName: string; category: "resident" | "guest" | "staff" | "other"; block?: string; houseNumber?: string; isActive: boolean; consentStatus: "recorded" | "not_recorded" | "withdrawn"; notes?: string; }
export interface Page<T> { items: T[]; pagination: { page: number; limit: number; total: number; totalPages: number } }

export async function fetchCaptures(page = 1, status?: CaptureStatus, direction?: "in" | "out") { const response = await api.get<ApiSuccess<Page<PersonCapture>>>("/api/person-captures", { params: { page, limit: 12, ...(status ? { status } : {}), ...(direction ? { direction } : {}) } }); return response.data.data; }
export async function fetchCapture(captureId: string) { const response = await api.get<ApiSuccess<PersonCapture>>(`/api/person-captures/${captureId}`); return response.data.data; }
export async function fetchPeople(search = "") { const response = await api.get<ApiSuccess<Page<RegisteredPerson>>>("/api/people", { params: { page: 1, limit: 100, active: "true", ...(search ? { search } : {}) } }); return response.data.data; }
export async function fetchCaptureImage(captureId: string, kind: "full-body" | "head" = "full-body") { const response = await api.get<Blob>(`/api/person-captures/${captureId}/images/${kind}`, { responseType: "blob" }); return response.data; }
export async function reviewCapture(captureId: string, action: "dismiss" | "reopen") { const response = await api.patch<ApiSuccess<PersonCapture>>(`/api/person-captures/${captureId}/review`, { action, confirmed: true }); return response.data.data; }
export async function deleteCapture(captureId: string) { const response = await api.delete<ApiSuccess<{ captureId: string; deleted: true; deletedImages: number; deletedAnnotations: number }>>(`/api/person-captures/${captureId}`, { data: { confirmed: true } }); return response.data.data; }
export async function verifyCapture(captureId: string, personId: string) { const response = await api.post<ApiSuccess<{ capture: PersonCapture; verificationId: string }>>(`/api/person-captures/${captureId}/verify`, { personId, confirmed: true }); return response.data.data; }
export async function createPerson(input: { fullName: string; category: RegisteredPerson["category"]; block?: string; houseNumber?: string; notes?: string; consentStatus: RegisteredPerson["consentStatus"] }) { const response = await api.post<ApiSuccess<RegisteredPerson>>("/api/people", input); return response.data.data; }
export async function updatePerson(personId: string, input: Partial<Pick<RegisteredPerson, "fullName" | "category" | "block" | "houseNumber" | "notes" | "consentStatus">>) { const response = await api.patch<ApiSuccess<RegisteredPerson>>(`/api/people/${personId}`, input); return response.data.data; }

export interface ActiveIdentity { cameraId: string; sessionId: string; trackId: number; personId: string; fullName: string; verifiedAt: string; expiresAt: string; method: "manual" | "credential" }
export async function fetchActiveIdentities(cameraId: string) { const response = await api.get<ApiSuccess<ActiveIdentity[]>>("/api/active-identities", { params: { cameraId } }); return response.data.data; }

export async function createAnnotation(input: { captureId: string; imageKind: "full-body" | "head"; className: "person" | "head" | "car" | "motorcycle"; xCenter: number; yCenter: number; width: number; height: number }) { const response = await api.post<ApiSuccess<{ annotationId: string }>>("/api/dataset/annotations", input); return response.data.data; }
export interface DatasetAnnotation { annotationId: string; captureId: string; imageKind: "full-body" | "head"; className: "person" | "head" | "car" | "motorcycle"; xCenter: number; yCenter: number; width: number; height: number; status: "draft" | "approved" | "rejected" }
export async function fetchAnnotations(captureId: string) { const response = await api.get<ApiSuccess<DatasetAnnotation[]>>("/api/dataset/annotations", { params: { captureId } }); return response.data.data; }
export async function updateAnnotation(annotationId: string, input: Partial<Omit<DatasetAnnotation, "annotationId" | "captureId">>) { const response = await api.patch<ApiSuccess<DatasetAnnotation>>(`/api/dataset/annotations/${annotationId}`, input); return response.data.data; }
export async function exportDataset() { const response = await api.post<ApiSuccess<{ versionId: string; imageCount: number; annotationCount: number }>>("/api/dataset/exports", { confirmed: true }); return response.data.data; }
