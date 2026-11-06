import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(5005),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z.string().min(1).max(64).default("cctv_ai"),
  CV_SERVICE_TOKEN: z.string().min(32, "CV_SERVICE_TOKEN must be at least 32 characters"),
  CORS_ORIGIN: z.string().min(1).transform((value) => value.split(",").map((origin) => origin.trim())),
  REPORT_TIMEZONE: z.string().default("Asia/Jakarta"),
  HEARTBEAT_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(3600).default(90),
  LIVE_PREVIEW_ENABLED: z.stringbool().default(true),
  LIVE_PREVIEW_MAX_FRAME_BYTES: z.coerce.number().int().min(65_536).max(5_242_880).default(524_288),
  LIVE_PREVIEW_MAX_SUBSCRIBERS_PER_CAMERA: z.coerce.number().int().min(1).max(50).default(5),
  LIVE_PREVIEW_STALE_SECONDS: z.coerce.number().int().min(2).max(120).default(10),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${message}`);
}

export const env = parsed.data;
