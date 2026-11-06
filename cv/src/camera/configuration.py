from __future__ import annotations

import os
from typing import Literal
from urllib.parse import urlsplit

import yaml
from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from src.config import PROJECT_ROOT, Settings


class CountingLineConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x1: float = Field(ge=0, le=1)
    y1: float = Field(ge=0, le=1)
    x2: float = Field(ge=0, le=1)
    y2: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def validate_length(self) -> "CountingLineConfig":
        if (self.x1, self.y1) == (self.x2, self.y2):
            raise ValueError("counting line endpoints must differ")
        return self


class CountingConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    line: CountingLineConfig
    direction_in: Literal["negative_to_positive", "positive_to_negative"]
    margin_pixels: float | None = Field(default=None, gt=0, le=500)
    anchor: Literal["bottom_center", "center"] | None = None


class CameraFileConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    camera_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    physical_camera_id: str | None = Field(default=None, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    name: str = Field(min_length=1, max_length=200)
    lens_name: str | None = Field(default=None, max_length=80)
    enabled: bool = True
    rtsp_url_env: str = Field(pattern=r"^[A-Z][A-Z0-9_]*$")
    counting: CountingConfig
    target_processing_fps: float | None = Field(default=None, gt=0, le=120)
    image_size: int | None = Field(default=None, ge=160, le=2048, multiple_of=32)
    live_preview_fps: float | None = Field(default=None, ge=2, le=10)
    live_preview_width: int | None = Field(default=None, ge=320, le=1920)
    live_preview_jpeg_quality: int | None = Field(default=None, ge=30, le=95)


class CameraFile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cameras: list[CameraFileConfig]

    @model_validator(mode="after")
    def validate_unique_ids(self) -> "CameraFile":
        ids = [camera.camera_id for camera in self.cameras]
        if len(ids) != len(set(ids)):
            raise ValueError("camera IDs must be unique")
        if not any(camera.enabled for camera in self.cameras):
            raise ValueError("at least one camera must be enabled")
        return self


class CameraRuntimeConfig(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    camera_id: str
    physical_camera_id: str | None
    name: str
    lens_name: str | None
    rtsp_url: SecretStr
    line: tuple[float, float, float, float]
    direction_in: Literal["negative_to_positive", "positive_to_negative"]
    margin_pixels: float
    anchor: Literal["bottom_center", "center"]
    target_processing_fps: float
    image_size: int
    live_preview_fps: float
    live_preview_width: int
    live_preview_jpeg_quality: int


def _environment_values() -> dict[str, str]:
    file_values = {key: value for key, value in dotenv_values(PROJECT_ROOT / ".env").items() if value is not None}
    return {**file_values, **os.environ}


def load_camera_configs(settings: Settings) -> list[CameraRuntimeConfig]:
    path = settings.camera_config_path
    if not path.exists():
        return [_legacy_camera(settings)]
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    parsed = CameraFile.model_validate(raw)
    environment = _environment_values()
    runtimes: list[CameraRuntimeConfig] = []
    for camera in parsed.cameras:
        if not camera.enabled:
            continue
        raw_url = environment.get(camera.rtsp_url_env, "").strip()
        if not raw_url and camera.camera_id == settings.CAMERA_ID:
            raw_url = settings.RTSP_URL.get_secret_value()
        parts = urlsplit(raw_url)
        if parts.scheme not in {"rtsp", "rtsps"} or not parts.hostname:
            raise ValueError(
                f"Enabled camera {camera.camera_id!r} requires a valid URL in {camera.rtsp_url_env}"
            )
        line = camera.counting.line
        runtimes.append(CameraRuntimeConfig(
            camera_id=camera.camera_id,
            physical_camera_id=camera.physical_camera_id,
            name=camera.name,
            lens_name=camera.lens_name,
            rtsp_url=SecretStr(raw_url),
            line=(line.x1, line.y1, line.x2, line.y2),
            direction_in=camera.counting.direction_in,
            margin_pixels=camera.counting.margin_pixels or settings.COUNTING_MARGIN,
            anchor=camera.counting.anchor or settings.COUNTING_ANCHOR,
            target_processing_fps=camera.target_processing_fps or settings.TARGET_PROCESSING_FPS,
            image_size=camera.image_size or settings.IMAGE_SIZE,
            live_preview_fps=camera.live_preview_fps or settings.LIVE_PREVIEW_FPS,
            live_preview_width=camera.live_preview_width or settings.LIVE_PREVIEW_WIDTH,
            live_preview_jpeg_quality=camera.live_preview_jpeg_quality or settings.LIVE_PREVIEW_JPEG_QUALITY,
        ))
    return runtimes


def _legacy_camera(settings: Settings) -> CameraRuntimeConfig:
    raw_url = settings.RTSP_URL.get_secret_value()
    parts = urlsplit(raw_url)
    if parts.scheme not in {"rtsp", "rtsps"} or not parts.hostname:
        raise ValueError("Legacy single-camera mode requires a valid RTSP_URL")
    return CameraRuntimeConfig(
        camera_id=settings.CAMERA_ID,
        physical_camera_id=None,
        name=settings.CAMERA_ID,
        lens_name=None,
        rtsp_url=SecretStr(raw_url),
        line=(settings.COUNTING_LINE_X1, settings.COUNTING_LINE_Y1, settings.COUNTING_LINE_X2, settings.COUNTING_LINE_Y2),
        direction_in=settings.COUNTING_DIRECTION_IN,
        margin_pixels=settings.COUNTING_MARGIN,
        anchor=settings.COUNTING_ANCHOR,
        target_processing_fps=settings.TARGET_PROCESSING_FPS,
        image_size=settings.IMAGE_SIZE,
        live_preview_fps=settings.LIVE_PREVIEW_FPS,
        live_preview_width=settings.LIVE_PREVIEW_WIDTH,
        live_preview_jpeg_quality=settings.LIVE_PREVIEW_JPEG_QUALITY,
    )
