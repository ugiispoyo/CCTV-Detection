import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

export async function requireServiceToken(request: FastifyRequest): Promise<void> {
  if (!isValidServiceAuthorization(request.headers.authorization)) throw new AppError(401, "UNAUTHORIZED", "A valid service token is required");
}

export function isValidServiceAuthorization(authorization: string | undefined): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = createHash("sha256").update(authorization.slice(7)).digest();
  const expected = createHash("sha256").update(env.CV_SERVICE_TOKEN).digest();
  return timingSafeEqual(supplied, expected);
}
