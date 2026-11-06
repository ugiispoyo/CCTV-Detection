import type { CountingDirection, ObjectType } from "../types/index.js";

export const OBJECT_TYPES = ["person", "car", "motorcycle"] as const satisfies readonly ObjectType[];
export const COUNTING_DIRECTIONS = ["in", "out"] as const satisfies readonly CountingDirection[];

export const OBJECT_CLASS_IDS: Readonly<Record<ObjectType, number>> = {
  person: 0,
  car: 2,
  motorcycle: 3,
};
