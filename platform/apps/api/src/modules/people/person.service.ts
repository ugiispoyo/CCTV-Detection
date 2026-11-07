import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import type { ClientSession } from "mongoose";
import { AppError, notFound } from "../../lib/errors.js";
import { IdentityAuditModel } from "./identity-audit.model.js";
import { IdentityVerificationModel } from "./identity-verification.model.js";
import { PersonModel, type PersonDocument } from "./person.model.js";

type PersonInput = { fullName: string; category: PersonDocument["category"]; block?: string | undefined; houseNumber?: string | undefined; consentStatus: PersonDocument["consentStatus"]; notes?: string | undefined };

function cleanIdentityValue(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizedIdentityValue(value: string | undefined): string {
  return cleanIdentityValue(value).toLocaleLowerCase("id-ID");
}

export function personRegistrationKey(input: Pick<PersonInput, "fullName" | "category" | "block" | "houseNumber">): string {
  const identity = [
    normalizedIdentityValue(input.fullName), input.category,
    normalizedIdentityValue(input.block), normalizedIdentityValue(input.houseNumber),
  ];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function exactNamePattern(value: string): RegExp {
  const words = cleanIdentityValue(value).split(" ").map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^\\s*${words.join("\\s+")}\\s*$`, "i");
}

export function serializePerson(person: PersonDocument) {
  return { personId: person.personId, fullName: person.fullName, category: person.category,
    ...(person.block ? { block: person.block } : {}), ...(person.houseNumber ? { houseNumber: person.houseNumber } : {}),
    isActive: person.isActive, consentStatus: person.consentStatus, ...(person.notes ? { notes: person.notes } : {}),
    createdAt: person.createdAt.toISOString(), updatedAt: person.updatedAt.toISOString() };
}

async function audit(action: string, values: { captureId?: string; personId?: string; details?: Record<string, unknown> } = {}, session?: ClientSession) {
  const payload = { auditId: crypto.randomUUID(), action, actor: env.OPERATOR_ID, occurredAt: new Date(), ...values };
  if (session) await IdentityAuditModel.create([payload], { session });
  else await IdentityAuditModel.create(payload);
}

export async function createPerson(input: PersonInput) {
  const normalizedInput = {
    ...input,
    fullName: cleanIdentityValue(input.fullName),
    ...(input.block !== undefined ? { block: cleanIdentityValue(input.block) } : {}),
    ...(input.houseNumber !== undefined ? { houseNumber: cleanIdentityValue(input.houseNumber) } : {}),
  };
  const registrationKey = personRegistrationKey(normalizedInput);
  let existing = await PersonModel.findOne({ registrationKey }).select("+registrationKey").lean();

  // Adopt matching records created before registrationKey existed. The final
  // in-memory comparison also handles repeated whitespace consistently.
  if (!existing) {
    const legacyCandidates = await PersonModel.find({
      category: normalizedInput.category,
      fullName: exactNamePattern(normalizedInput.fullName),
    }).select("+registrationKey").limit(25).lean();
    const legacy = legacyCandidates.find((candidate) => personRegistrationKey(candidate) === registrationKey);
    if (legacy) {
      try {
        await PersonModel.updateOne({ _id: legacy._id }, { $set: { registrationKey } });
        existing = { ...legacy, registrationKey };
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        existing = await PersonModel.findOne({ registrationKey }).select("+registrationKey").lean();
      }
    }
  }
  if (existing) {
    await audit("person.registration_reused", { personId: existing.personId });
    return serializePerson(existing);
  }

  try {
    const person = await PersonModel.create({ personId: crypto.randomUUID(), registrationKey,
      fullName: normalizedInput.fullName, category: normalizedInput.category,
      consentStatus: normalizedInput.consentStatus, ...(normalizedInput.block !== undefined ? { block: normalizedInput.block } : {}),
      ...(normalizedInput.houseNumber !== undefined ? { houseNumber: normalizedInput.houseNumber } : {}), ...(normalizedInput.notes !== undefined ? { notes: normalizedInput.notes } : {}) });
    await audit("person.created", { personId: person.personId });
    return serializePerson(person.toObject());
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const concurrent = await PersonModel.findOne({ registrationKey }).select("+registrationKey").lean();
    if (!concurrent) throw error;
    await audit("person.registration_reused", { personId: concurrent.personId });
    return serializePerson(concurrent);
  }
}

export async function listPeople(query: { page: number; limit: number; search?: string | undefined; category?: PersonDocument["category"] | undefined; active?: "true" | "false" | undefined }) {
  const filter: Record<string, unknown> = {};
  if (query.active) filter.isActive = query.active === "true";
  if (query.category) filter.category = query.category;
  if (query.search) filter.fullName = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([PersonModel.find(filter).sort({ fullName: 1 }).skip(skip).limit(query.limit).lean(), PersonModel.countDocuments(filter)]);
  return { items: items.map(serializePerson), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function getPerson(personId: string) {
  const person = await PersonModel.findOne({ personId }).lean();
  if (!person) throw notFound("Registered person not found");
  return serializePerson(person);
}

export async function updatePerson(personId: string, input: { fullName?: string | undefined; category?: PersonDocument["category"] | undefined; block?: string | undefined; houseNumber?: string | undefined; consentStatus?: PersonDocument["consentStatus"] | undefined; notes?: string | undefined; isActive?: boolean | undefined; anonymize?: boolean | undefined }) {
  const current = await PersonModel.findOne({ personId }).select("+registrationKey").lean();
  if (!current) throw notFound("Registered person not found");
  const update: Record<string, unknown> = { ...input };
  delete update.anonymize;
  let mongoUpdate: Record<string, unknown> = update;
  if (input.anonymize) {
    mongoUpdate = { $set: { fullName: "Anonymized", category: "other", block: null, houseNumber: null, notes: null, isActive: false, consentStatus: "withdrawn", credentials: [] }, $unset: { registrationKey: 1 } };
  } else {
    if (input.fullName !== undefined) update.fullName = cleanIdentityValue(input.fullName);
    if (input.block !== undefined) update.block = cleanIdentityValue(input.block);
    if (input.houseNumber !== undefined) update.houseNumber = cleanIdentityValue(input.houseNumber);
    const registrationKey = personRegistrationKey({
      fullName: (update.fullName as string | undefined) ?? current.fullName,
      category: (update.category as PersonDocument["category"] | undefined) ?? current.category,
      block: (update.block as string | undefined) ?? current.block,
      houseNumber: (update.houseNumber as string | undefined) ?? current.houseNumber,
    });
    const duplicate = await PersonModel.findOne({ registrationKey }).select("personId").lean();
    if (duplicate && duplicate.personId !== personId) throw new AppError(409, "REGISTERED_PERSON_DUPLICATE", "A registered person with the same normalized details already exists");
    update.registrationKey = registrationKey;
  }
  try {
    const person = await PersonModel.findOneAndUpdate({ personId }, mongoUpdate, { new: true, runValidators: true }).lean();
    if (!person) throw notFound("Registered person not found");
    await audit(input.anonymize ? "person.anonymized" : "person.updated", { personId });
    return serializePerson(person);
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new AppError(409, "REGISTERED_PERSON_DUPLICATE", "A registered person with the same normalized details already exists");
    }
    throw error;
  }
}

function verifier(credential: string): string {
  if (!env.CREDENTIAL_PEPPER) throw new AppError(503, "CREDENTIALS_DISABLED", "Credential verification is not configured");
  return createHmac("sha256", env.CREDENTIAL_PEPPER).update(credential).digest("hex");
}

export async function createCredential(personId: string) {
  const credentialId = crypto.randomUUID();
  const credential = `${credentialId}.${randomBytes(32).toString("base64url")}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + env.CREDENTIAL_TTL_SECONDS * 1000);
  const person = await PersonModel.findOneAndUpdate({ personId, isActive: true }, { $push: { credentials: { credentialId, verifier: verifier(credential), createdAt, expiresAt } } }, { new: true });
  if (!person) throw notFound("Active registered person not found");
  await audit("credential.created", { personId, details: { credentialId } });
  return { credentialId, credential, warning: "One-time credential: shown once and invalid after use or expiry.", expiresAt: expiresAt.toISOString() };
}

export async function revokeCredential(personId: string, credentialId: string) {
  const person = await PersonModel.findOneAndUpdate({ personId, "credentials.credentialId": credentialId }, { $set: { "credentials.$.revokedAt": new Date() } }, { new: true });
  if (!person) throw notFound("Credential not found");
  await audit("credential.revoked", { personId, details: { credentialId } });
  return serializePerson(person.toObject());
}

export async function resolveCredential(credential: string) {
  const separator = credential.indexOf(".");
  const credentialId = separator > 0 ? credential.slice(0, separator) : "";
  if (!credentialId) throw new AppError(401, "INVALID_CREDENTIAL", "Credential verification failed");
  const person = await PersonModel.findOne({ isActive: true, "credentials.credentialId": credentialId });
  const now = new Date();
  const credentialRecord = person?.credentials.find((item) => item.credentialId === credentialId && !item.revokedAt && !item.usedAt && item.expiresAt && item.expiresAt > now);
  const stored = credentialRecord?.verifier;
  const candidate = verifier(credential);
  if (!person || !stored || !timingSafeEqual(Buffer.from(candidate), Buffer.from(stored))) throw new AppError(401, "INVALID_CREDENTIAL", "Credential verification failed");
  if (!credentialRecord) throw new AppError(401, "INVALID_CREDENTIAL", "Credential verification failed");
  credentialRecord.usedAt = now;
  await person.save();
  return person;
}

export async function verifyCredential(credential: string) {
  const person = await resolveCredential(credential);
  const verificationId = crypto.randomUUID();
  await IdentityVerificationModel.create({ verificationId, personId: person.personId, method: "credential", verifiedAt: new Date(), verifiedBy: env.OPERATOR_ID });
  await audit("credential.verified", { personId: person.personId, details: { verificationId } });
  return { verified: true, verificationId, person: serializePerson(person.toObject()) };
}

export { audit as auditIdentityAction };

export async function ensurePeopleIndexes(): Promise<void> {
  await PersonModel.createIndexes();
}
