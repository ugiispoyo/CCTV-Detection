import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";

export function isValidOperatorToken(value: string | undefined): boolean {
  if (!env.OPERATOR_TOKEN || !value) return false;
  const supplied = createHash("sha256").update(value).digest();
  const expected = createHash("sha256").update(env.OPERATOR_TOKEN).digest();
  return timingSafeEqual(supplied, expected);
}

export function isValidOperatorProtocol(value: string | undefined): boolean {
  const prefix = "cctv-operator.";
  if (!value?.startsWith(prefix)) return false;
  try { return isValidOperatorToken(Buffer.from(value.slice(prefix.length), "base64url").toString("utf8")); }
  catch { return false; }
}

export async function requireOperator(request: FastifyRequest): Promise<void> {
  const token = request.headers["x-operator-token"];
  if (!env.OPERATOR_TOKEN) throw new AppError(503, "OPERATOR_ACCESS_DISABLED", "Protected operator access is not configured");
  if (typeof token !== "string" || !isValidOperatorToken(token)) {
    throw new AppError(401, "OPERATOR_UNAUTHORIZED", "Valid operator access is required");
  }
}
