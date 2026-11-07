import { env } from "../../config/env.js";
import { isTrackActive } from "../live-preview/track-activity.js";

export interface ActiveIdentity {
  cameraId: string; sessionId: string; trackId: number; personId: string; fullName: string;
  verifiedAt: string; expiresAt: string; method: "manual" | "credential";
}

const associations = new Map<string, ActiveIdentity>();
const key = (cameraId: string, sessionId: string, trackId: number) => `${cameraId}\u0000${sessionId}\u0000${trackId}`;

export function associateActiveIdentity(
  capture: { cameraId: string; sessionId: string; trackId: number },
  person: { personId: string; fullName: string }, method: ActiveIdentity["method"],
): ActiveIdentity | undefined {
  if (!isTrackActive(capture.cameraId, capture.sessionId, capture.trackId)) return undefined;
  const now = new Date();
  const association: ActiveIdentity = {
    ...capture, personId: person.personId, fullName: person.fullName, method,
    verifiedAt: now.toISOString(), expiresAt: new Date(now.getTime() + env.ACTIVE_IDENTITY_TTL_SECONDS * 1000).toISOString(),
  };
  associations.set(key(capture.cameraId, capture.sessionId, capture.trackId), association);
  return association;
}

export function listActiveIdentities(cameraId?: string): ActiveIdentity[] {
  const now = Date.now();
  for (const [associationKey, value] of associations) {
    if (new Date(value.expiresAt).getTime() <= now || !isTrackActive(value.cameraId, value.sessionId, value.trackId)) associations.delete(associationKey);
  }
  return [...associations.values()].filter((value) => !cameraId || value.cameraId === cameraId);
}
