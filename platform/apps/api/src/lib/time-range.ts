import { DateTime } from "luxon";
import { AppError } from "./errors.js";

export type RangePreset = "today" | "yesterday" | "7d" | "30d" | "custom";

export interface RangeInput {
  range?: RangePreset | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  timezone?: string | undefined;
}

export function resolveTimeRange(input: RangeInput, defaultTimezone: string): { start: Date; end: Date; timezone: string } {
  const timezone = input.timezone ?? defaultTimezone;
  const now = DateTime.now().setZone(timezone);
  if (!now.isValid) throw new AppError(400, "VALIDATION_ERROR", "Invalid reporting timezone");

  const preset = input.range ?? "today";
  let start: DateTime;
  let end: DateTime;

  if (preset === "custom") {
    if (!input.startDate || !input.endDate) {
      throw new AppError(400, "VALIDATION_ERROR", "startDate and endDate are required for a custom range");
    }
    start = DateTime.fromISO(input.startDate, { setZone: true }).setZone(timezone);
    end = DateTime.fromISO(input.endDate, { setZone: true }).setZone(timezone);
  } else if (preset === "yesterday") {
    start = now.minus({ days: 1 }).startOf("day");
    end = start.plus({ days: 1 });
  } else {
    const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 1;
    start = now.startOf("day").minus({ days: days - 1 });
    end = now.plus({ days: 1 }).startOf("day");
  }

  if (!start.isValid || !end.isValid || start >= end) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid date range");
  }
  if (end.diff(start, "days").days > 366) {
    throw new AppError(400, "VALIDATION_ERROR", "Date range cannot exceed 366 days");
  }
  return { start: start.toUTC().toJSDate(), end: end.toUTC().toJSDate(), timezone };
}
