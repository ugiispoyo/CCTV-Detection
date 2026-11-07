import { Schema, model } from "mongoose";
export interface IdentityVerificationDocument { verificationId: string; personId: string; captureId?: string; method: "manual" | "credential"; verifiedAt: Date; verifiedBy?: string; cameraId?: string }
const schema = new Schema<IdentityVerificationDocument>({
  verificationId: { type: String, required: true, unique: true }, personId: { type: String, required: true, index: true },
  captureId: { type: String, index: true }, method: { type: String, enum: ["manual", "credential"], required: true },
  verifiedAt: { type: Date, required: true }, verifiedBy: String, cameraId: String,
}, { collection: "identity_verification_events", versionKey: false });
schema.index({ verifiedAt: -1 });
export const IdentityVerificationModel = model<IdentityVerificationDocument>("IdentityVerification", schema);
