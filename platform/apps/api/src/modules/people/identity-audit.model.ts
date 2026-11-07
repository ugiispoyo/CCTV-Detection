import { Schema, model } from "mongoose";
const schema = new Schema({
  auditId: { type: String, required: true, unique: true }, action: { type: String, required: true }, actor: { type: String, required: true },
  captureId: String, personId: String, occurredAt: { type: Date, required: true }, details: { type: Schema.Types.Mixed },
}, { collection: "identity_audit_events", versionKey: false });
schema.index({ occurredAt: -1 }); schema.index({ captureId: 1, occurredAt: -1 });
export const IdentityAuditModel = model("IdentityAudit", schema);
