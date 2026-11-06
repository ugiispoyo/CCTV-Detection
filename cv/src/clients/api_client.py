from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field

LOGGER = logging.getLogger(__name__)
ObjectType = Literal["person", "car", "motorcycle"]
Direction = Literal["in", "out"]


class DetectionEventPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    eventId: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    cameraId: str = Field(min_length=1, max_length=80)
    sessionId: str = Field(min_length=1, max_length=100)
    trackId: int = Field(ge=0, le=2_147_483_647)
    objectType: ObjectType
    eventType: Literal["line_crossing"] = "line_crossing"
    direction: Direction
    confidence: float | None = Field(default=None, ge=0, le=1)
    timestamp: datetime

    def wire_dict(self) -> dict[str, object]:
        return self.model_dump(mode="json", exclude_none=True)


class HeartbeatPayload(BaseModel):
    workerId: str
    cameraId: str
    status: Literal["online", "offline"]
    timestamp: datetime


class APIAuthenticationError(RuntimeError):
    pass


class CameraConfigurationError(RuntimeError):
    pass


class APIClient:
    def __init__(self, base_url: str, token: str, timeout_seconds: float) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=httpx.Timeout(timeout_seconds),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )

    def get_camera_config(self, camera_id: str) -> dict[str, object]:
        response = self._client.get("/internal/cv/config")
        if response.status_code in (401, 403):
            raise APIAuthenticationError("Fastify rejected the CV service token")
        response.raise_for_status()
        payload = response.json()
        cameras = payload.get("data", {}).get("cameras", [])
        camera = next((item for item in cameras if item.get("cameraId") == camera_id), None)
        if not camera or not camera.get("enabled"):
            raise CameraConfigurationError(f"Camera {camera_id!r} is not active in Fastify")
        allowed = set(camera.get("allowedObjectClasses", []))
        if not {"person", "car", "motorcycle"}.issubset(allowed):
            raise CameraConfigurationError("Fastify camera configuration does not allow all required object classes")
        return camera

    def post_event(self, event: DetectionEventPayload) -> httpx.Response:
        return self._client.post("/internal/cv/events", json=event.wire_dict())

    def post_heartbeat(self, heartbeat: HeartbeatPayload) -> httpx.Response:
        return self._client.post(
            "/internal/cv/heartbeat",
            json=heartbeat.model_dump(mode="json"),
        )

    def close(self) -> None:
        self._client.close()
