import { z } from "zod";
import { identifierSchema, paginationSchema, successSchema } from "../../lib/schemas.js";
export const categorySchema = z.enum(["resident", "guest", "staff", "other"]);
export const consentSchema = z.enum(["recorded", "not_recorded", "withdrawn"]);
export const personParamsSchema = z.object({ personId: identifierSchema });
export const createPersonSchema = z.object({
  fullName: z.string().trim().min(1).max(200), category: categorySchema,
  block: z.string().trim().max(50).optional(), houseNumber: z.string().trim().max(50).optional(),
  consentStatus: consentSchema.default("not_recorded"), notes: z.string().trim().max(1000).optional(),
});
export const updatePersonSchema = createPersonSchema.partial().extend({ isActive: z.boolean().optional(), anonymize: z.boolean().optional() });
export const peopleListQuerySchema = paginationSchema.extend({ search: z.string().trim().max(100).optional(), category: categorySchema.optional(), active: z.enum(["true", "false"]).optional() });
export const personDtoSchema = z.object({
  personId: z.string(), fullName: z.string(), category: categorySchema, block: z.string().optional(), houseNumber: z.string().optional(),
  isActive: z.boolean(), consentStatus: consentSchema, notes: z.string().optional(), createdAt: z.string(), updatedAt: z.string(),
});
export const personResponseSchema = successSchema(personDtoSchema);
export const peopleListResponseSchema = successSchema(z.object({ items: z.array(personDtoSchema), pagination: z.object({ page: z.number(), limit: z.number(), total: z.number(), totalPages: z.number() }) }));
export const createCredentialSchema = z.object({});
export const credentialParamsSchema = z.object({ personId: identifierSchema, credentialId: z.uuid() });
export const verifyCredentialSchema = z.object({ credential: z.string().min(32).max(512) });
export const credentialCreatedResponseSchema = successSchema(z.object({ credentialId: z.string(), credential: z.string(), warning: z.string(), expiresAt: z.string() }));
export const credentialVerificationResponseSchema = successSchema(z.object({ verified: z.boolean(), verificationId: z.string(), person: personDtoSchema }));
