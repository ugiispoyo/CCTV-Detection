from __future__ import annotations

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import AnyHttpUrl, AnyWebsocketUrl, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """Validated configuration loaded from cv/.env regardless of the launch directory."""

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    API_BASE_URL: AnyHttpUrl = "http://127.0.0.1:5005"
    CV_SERVICE_TOKEN: SecretStr = Field(min_length=32)
    WORKER_ID: str = Field(default="cv-worker-001", min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    CAMERA_ID: str = Field(default="cam-001", min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

    RTSP_URL: SecretStr = SecretStr("")
    CAMERA_CONFIG: str = "config/cameras.yaml"
    RTSP_TRANSPORT: Literal["tcp", "udp"] = "tcp"
    RTSP_CONNECT_TIMEOUT_MS: int = Field(default=10_000, ge=1_000, le=120_000)
    RTSP_READ_TIMEOUT_MS: int = Field(default=10_000, ge=1_000, le=120_000)
    RTSP_RECONNECT_INITIAL_SECONDS: float = Field(default=2, ge=0.5, le=300)
    RTSP_RECONNECT_MAX_SECONDS: float = Field(default=30, ge=1, le=600)

    MODEL_PATH: str = "yolo26n.pt"
    DEVICE: Literal["auto", "mps", "cpu"] = "auto"
    CONFIDENCE_THRESHOLD: float = Field(default=0.30, ge=0.01, le=1)
    IOU_THRESHOLD: float = Field(default=0.50, ge=0.01, le=1)
    IMAGE_SIZE: int = Field(default=640, ge=160, le=2048, multiple_of=32)

    TARGET_PROCESSING_FPS: float = Field(default=10, gt=0, le=120)
    CV_HEADLESS: bool = True
    LOCAL_PREVIEW_ENABLED: bool = False
    LIVE_PREVIEW_ENABLED: bool = True
    LIVE_PREVIEW_FPS: float = Field(default=5, ge=2, le=10)
    LIVE_PREVIEW_WIDTH: int = Field(default=960, ge=320, le=1920)
    LIVE_PREVIEW_JPEG_QUALITY: int = Field(default=70, ge=30, le=95)
    LIVE_PREVIEW_MAX_FRAME_BYTES: int = Field(default=524_288, ge=65_536, le=5_242_880)
    CV_PREVIEW_WS_URL: AnyWebsocketUrl = "ws://127.0.0.1:5005/internal/cv/preview"
    CV_PREVIEW_RECONNECT_INITIAL_SECONDS: float = Field(default=2, ge=0.5, le=300)
    CV_PREVIEW_RECONNECT_MAX_SECONDS: float = Field(default=30, ge=1, le=600)

    COUNTING_LINE_X1: float = Field(default=0.10, ge=0, le=1)
    COUNTING_LINE_Y1: float = Field(default=0.60, ge=0, le=1)
    COUNTING_LINE_X2: float = Field(default=0.90, ge=0, le=1)
    COUNTING_LINE_Y2: float = Field(default=0.60, ge=0, le=1)
    COUNTING_MARGIN: float = Field(default=8, gt=0, le=500)
    COUNTING_DIRECTION_IN: Literal["negative_to_positive", "positive_to_negative"] = "negative_to_positive"
    COUNTING_ANCHOR: Literal["bottom_center", "center"] = "bottom_center"
    COUNTING_REARM_SECONDS: float = Field(default=1.5, ge=0.5, le=30)

    API_TIMEOUT_SECONDS: float = Field(default=5, gt=0, le=120)
    EVENT_RETRY_INITIAL_SECONDS: float = Field(default=2, ge=0.5, le=300)
    EVENT_RETRY_MAX_SECONDS: float = Field(default=60, ge=1, le=3600)

    HEARTBEAT_INTERVAL_SECONDS: float = Field(default=15, ge=5, le=3600)
    METRICS_INTERVAL_SECONDS: float = Field(default=30, ge=5, le=3600)

    EVENT_QUEUE_DATABASE: str = "data/events.sqlite3"
    EVENT_QUEUE_MAX_PENDING: int = Field(default=10_000, ge=100, le=1_000_000)
    EVENT_QUEUE_RETAIN_DELIVERED: bool = False
    PERSON_CAPTURE_ENABLED: bool = True
    PERSON_CAPTURE_TRIGGER: Literal["line_crossing"] = "line_crossing"
    PERSON_CAPTURE_DIRECTION: Literal["in", "out", "both"] = "both"
    PERSON_FULL_BODY_CROP_ENABLED: bool = True
    PERSON_CAPTURE_MIN_CONFIDENCE: float = Field(default=0.65, ge=0.01, le=1)
    PERSON_CAPTURE_MIN_WIDTH: int = Field(default=80, ge=16, le=4096)
    PERSON_CAPTURE_MIN_HEIGHT: int = Field(default=140, ge=16, le=4096)
    PERSON_CAPTURE_PADDING: float = Field(default=0.10, ge=0, le=0.5)
    PERSON_CAPTURE_JPEG_QUALITY: int = Field(default=80, ge=30, le=95)
    PERSON_CAPTURE_MAX_CANDIDATES: int = Field(default=5, ge=1, le=30)
    PERSON_CAPTURE_BUFFER_SECONDS: float = Field(default=3, ge=0.5, le=30)
    PERSON_HEAD_CROP_ENABLED: bool = True
    HEAD_DETECTION_MODEL_PATH: str = ""
    HEAD_DETECTION_ALLOW_OPENCV_FALLBACK: bool = True
    HEAD_DETECTION_MIN_CONFIDENCE: float = Field(default=0.60, ge=0.01, le=1)
    HEAD_CROP_PADDING: float = Field(default=0.15, ge=0, le=0.5)
    HEAD_CROP_MIN_WIDTH: int = Field(default=40, ge=8, le=2048)
    HEAD_CROP_MIN_HEIGHT: int = Field(default=40, ge=8, le=2048)
    PERSON_CAPTURE_MAX_FILE_BYTES: int = Field(default=524_288, ge=32_768, le=5_242_880)
    PERSON_CAPTURE_STORAGE_DIR: str = "data/snapshots"
    PERSON_CAPTURE_RETENTION_DAYS: int = Field(default=7, ge=1, le=365)
    PERSON_CAPTURE_RETRY_INITIAL_SECONDS: float = Field(default=2, ge=0.5, le=300)
    PERSON_CAPTURE_RETRY_MAX_SECONDS: float = Field(default=60, ge=1, le=3600)
    DATASET_EXPORT_DIR: str = "data/datasets"
    DATASET_TRAINING_ENABLED: bool = False
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    @model_validator(mode="after")
    def validate_relationships(self) -> "Settings":
        if self.RTSP_RECONNECT_INITIAL_SECONDS > self.RTSP_RECONNECT_MAX_SECONDS:
            raise ValueError("RTSP reconnect initial delay cannot exceed maximum delay")
        if self.EVENT_RETRY_INITIAL_SECONDS > self.EVENT_RETRY_MAX_SECONDS:
            raise ValueError("Event retry initial delay cannot exceed maximum delay")
        if self.CV_PREVIEW_RECONNECT_INITIAL_SECONDS > self.CV_PREVIEW_RECONNECT_MAX_SECONDS:
            raise ValueError("Preview reconnect initial delay cannot exceed maximum delay")
        if self.PERSON_CAPTURE_RETRY_INITIAL_SECONDS > self.PERSON_CAPTURE_RETRY_MAX_SECONDS:
            raise ValueError("Person capture retry initial delay cannot exceed maximum delay")
        if not self.CV_HEADLESS or self.LOCAL_PREVIEW_ENABLED:
            raise ValueError("The CV runtime is headless; local GUI preview is not supported")
        if (self.COUNTING_LINE_X1, self.COUNTING_LINE_Y1) == (
            self.COUNTING_LINE_X2,
            self.COUNTING_LINE_Y2,
        ):
            raise ValueError("Counting line endpoints must be different")
        if not self.MODEL_PATH.strip():
            raise ValueError("MODEL_PATH cannot be empty")
        legacy_url = self.RTSP_URL.get_secret_value()
        if legacy_url:
            rtsp_parts = urlsplit(legacy_url)
            if rtsp_parts.scheme not in {"rtsp", "rtsps"} or not rtsp_parts.hostname:
                raise ValueError("RTSP_URL must be a valid rtsp:// or rtsps:// URL")
        return self

    @property
    def api_base_url(self) -> str:
        return str(self.API_BASE_URL).rstrip("/")

    @property
    def model_path(self) -> Path:
        path = Path(self.MODEL_PATH).expanduser()
        if not path.is_absolute():
            path = PROJECT_ROOT / "models" / path.name if path.parent == Path(".") else PROJECT_ROOT / path
        return path.resolve()

    @property
    def preview_ws_url(self) -> str:
        return str(self.CV_PREVIEW_WS_URL)

    @property
    def queue_database_path(self) -> Path:
        path = Path(self.EVENT_QUEUE_DATABASE).expanduser()
        return (PROJECT_ROOT / path).resolve() if not path.is_absolute() else path.resolve()

    @property
    def camera_config_path(self) -> Path:
        path = Path(self.CAMERA_CONFIG).expanduser()
        return (PROJECT_ROOT / path).resolve() if not path.is_absolute() else path.resolve()

    @property
    def person_capture_storage_path(self) -> Path:
        path = Path(self.PERSON_CAPTURE_STORAGE_DIR).expanduser()
        return (PROJECT_ROOT / path).resolve() if not path.is_absolute() else path.resolve()

    @property
    def head_detection_model_path(self) -> Path | None:
        if not self.HEAD_DETECTION_MODEL_PATH.strip():
            return None
        path = Path(self.HEAD_DETECTION_MODEL_PATH).expanduser()
        return (PROJECT_ROOT / path).resolve() if not path.is_absolute() else path.resolve()

    @property
    def dataset_export_path(self) -> Path:
        path = Path(self.DATASET_EXPORT_DIR).expanduser()
        return (PROJECT_ROOT / path).resolve() if not path.is_absolute() else path.resolve()
