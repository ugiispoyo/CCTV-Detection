import mongoose from "mongoose";
import { env } from "../config/env.js";

export async function connectDatabase(): Promise<void> {
  mongoose.set("sanitizeFilter", true);
  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 5_000,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}
