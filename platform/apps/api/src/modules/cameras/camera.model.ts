import { Schema, model } from "mongoose";

export interface CameraDocument {
  cameraId: string;
  name: string;
  description?: string;
  location?: string;
  physicalCameraId?: string;
  lensName?: string;
  status: "online" | "offline" | "unknown";
  isActive: boolean;
  lastHeartbeatAt?: Date;
  lastWorkerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const cameraSchema = new Schema<CameraDocument>(
  {
    cameraId: { type: String, required: true, unique: true, immutable: true, maxlength: 80 },
    name: { type: String, required: true, maxlength: 200 },
    description: { type: String, maxlength: 500 },
    location: { type: String, maxlength: 200 },
    physicalCameraId: { type: String, maxlength: 80 },
    lensName: { type: String, maxlength: 80 },
    status: { type: String, enum: ["online", "offline", "unknown"], default: "unknown" },
    isActive: { type: Boolean, default: true },
    lastHeartbeatAt: Date,
    lastWorkerId: { type: String, maxlength: 80 },
  },
  { timestamps: true, collection: "cameras", versionKey: false },
);

export const CameraModel = model<CameraDocument>("Camera", cameraSchema);
