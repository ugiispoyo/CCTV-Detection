import fp from "fastify-plugin";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { Error as MongooseError } from "mongoose";
import { AppError } from "../lib/errors.js";

export const errorHandlerPlugin = fp(async (app) => {
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ success: false, error: { code: "NOT_FOUND", message: "Route not found" } }));
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request", details: error.validation } });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) } });
    }
    if (error instanceof MongooseError.ValidationError || error instanceof MongooseError.CastError) {
      return reply.code(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } });
    }
    request.log.error({ err: error }, "Request failed");
    return reply.code(500).send({ success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
  });
});
