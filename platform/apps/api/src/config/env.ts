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
  PERSON_CAPTURE_STORAGE_DIR: z.string().min(1).default("storage/person-captures"),
  PERSON_CAPTURE_MAX_FILE_BYTES: z.coerce.number().int().min(32_768).max(5_242_880).default(524_288),
  PERSON_CAPTURE_MAX_WIDTH: z.coerce.number().int().min(80).max(8_192).default(2048),
  PERSON_CAPTURE_MAX_HEIGHT: z.coerce.number().int().min(80).max(8_192).default(4096),
  PERSON_CAPTURE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(7),
  PERSON_CAPTURE_REVIEWED_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  PERSON_CAPTURE_LINE_IDS: z.string().default("entry-line").transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),
  OPERATOR_ID: z.string().min(1).max(80).default("local-operator"),
  OPERATOR_TOKEN: z.string().default("").refine((value) => value.length === 0 || value.length >= 32, "OPERATOR_TOKEN must be empty or at least 32 characters"),
  CREDENTIAL_PEPPER: z.string().default("").refine((value) => value.length === 0 || value.length >= 32, "CREDENTIAL_PEPPER must be empty or at least 32 characters"),
  CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
  DATASET_EXPORT_DIR: z.string().min(1).default("../../../cv/data/datasets"),
  DATASET_TRAINING_ENABLED: z.stringbool().default(false),
  ACTIVE_IDENTITY_TTL_SECONDS: z.coerce.number().int().min(15).max(3600).default(180),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${message}`);
}

export const env = parsed.data;
