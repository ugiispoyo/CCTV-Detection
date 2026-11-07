interface ActiveTrack { trackId: number; objectType: string; bbox: [number, number, number, number] }
const latest = new Map<string, { sessionId?: string; tracks: ActiveTrack[]; seenAt: number }>();

export function updateActiveTracks(cameraId: string, sessionId: string, tracks: ActiveTrack[]): void {
  latest.set(cameraId, { sessionId, tracks, seenAt: Date.now() });
}

export function isTrackActive(cameraId: string, sessionId: string, trackId: number): boolean {
  const state = latest.get(cameraId);
  return Boolean(state && state.sessionId === sessionId && Date.now() - state.seenAt <= 15_000 && state.tracks.some((track) => track.objectType === "person" && track.trackId === trackId));
}
