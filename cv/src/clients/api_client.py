from __future__ import annotations

import logging
import base64
from datetime import datetime
from pathlib import Path
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


class PersonCapturePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    captureId: str = Field(min_length=36, max_length=36)
    cameraId: str = Field(min_length=1, max_length=80)
    sessionId: str = Field(min_length=1, max_length=100)
    trackId: int = Field(ge=0, le=2_147_483_647)
    crossingId: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    lineId: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    direction: Direction
    objectType: Literal["person"] = "person"
    confidence: float = Field(ge=0, le=1)
    capturedAt: datetime

    def wire_dict(self) -> dict[str, object]:
        return self.model_dump(mode="json")


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

    def post_person_capture(self, capture: PersonCapturePayload, full_body_path: Path,
                            head_path: Path | None) -> httpx.Response:
        full_body = full_body_path.read_bytes()
        return self._client.post(
            "/internal/cv/person-captures",
            json={
                **capture.wire_dict(),
                "fullBodyImageBase64": base64.b64encode(full_body).decode("ascii"),
                **(
                    {"headImageBase64": base64.b64encode(head_path.read_bytes()).decode("ascii")}
                    if head_path is not None else {}
                ),
            },
        )

    def close(self) -> None:
        self._client.close()
