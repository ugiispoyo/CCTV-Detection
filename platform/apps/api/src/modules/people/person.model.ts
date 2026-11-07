import { Schema, model } from "mongoose";

export interface CredentialDocument { credentialId: string; verifier: string; createdAt: Date; expiresAt?: Date; usedAt?: Date; revokedAt?: Date }
export interface PersonDocument {
  personId: string; fullName: string; category: "resident" | "guest" | "staff" | "other";
  registrationKey?: string;
  block?: string; houseNumber?: string; isActive: boolean;
  consentStatus: "recorded" | "not_recorded" | "withdrawn"; notes?: string;
  credentials: CredentialDocument[]; createdAt: Date; updatedAt: Date;
}
const credentialSchema = new Schema<CredentialDocument>({
  credentialId: { type: String, required: true }, verifier: { type: String, required: true }, createdAt: { type: Date, required: true }, expiresAt: Date, usedAt: Date, revokedAt: Date,
}, { _id: false });
const schema = new Schema<PersonDocument>({
  personId: { type: String, required: true, unique: true, immutable: true },
  registrationKey: { type: String, maxlength: 64, select: false },
  fullName: { type: String, required: true, minlength: 1, maxlength: 200 },
  category: { type: String, required: true, enum: ["resident", "guest", "staff", "other"] },
  block: { type: String, maxlength: 50 }, houseNumber: { type: String, maxlength: 50 },
  isActive: { type: Boolean, default: true },
  consentStatus: { type: String, enum: ["recorded", "not_recorded", "withdrawn"], default: "not_recorded" },
  notes: { type: String, maxlength: 1000 }, credentials: { type: [credentialSchema], default: [] },
}, { timestamps: true, collection: "registered_people", versionKey: false });
schema.index({ fullName: 1 }); schema.index({ category: 1, isActive: 1 });
schema.index({ registrationKey: 1 }, { unique: true, sparse: true, name: "unique_person_registration" });
schema.index({ "credentials.credentialId": 1 }, { sparse: true });
export const PersonModel = model<PersonDocument>("RegisteredPerson", schema);
