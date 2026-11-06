export type ObjectType = "person" | "car" | "motorcycle";

export type CameraStatus = "online" | "offline" | "unknown";

export type CountingDirection = "in" | "out";

export interface DetectionEvent {
  eventId: string;
  cameraId: string;
  sessionId: string;
  trackId: number;
  objectType: ObjectType;
  eventType: "line_crossing";
  direction: CountingDirection;
  confidence?: number;
  timestamp: string;
}

export interface Camera {
  cameraId: string;
  name: string;
  description?: string;
  location?: string;
  physicalCameraId?: string;
  lensName?: string;
  status: CameraStatus;
  isActive: boolean;
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CountingBucket {
  objectType: ObjectType;
  direction: CountingDirection;
  count: number;
}

export interface TimelinePoint extends CountingBucket {
  periodStart: string;
  cameraId?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedData<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface RealtimeMessage<T = unknown> {
  type: "detection.created" | "counting.updated" | "camera.status_changed";
  data: T;
}
