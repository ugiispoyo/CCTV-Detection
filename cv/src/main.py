from __future__ import annotations

import logging
import signal
import sys
import threading

import httpx
from pydantic import ValidationError

from src.camera.configuration import CameraRuntimeConfig, load_camera_configs
from src.camera.manager import CameraManager, CameraRuntime
from src.camera.rtsp import RTSPCapture
from src.camera.worker import CameraWorker
from src.clients.api_client import APIAuthenticationError, APIClient, CameraConfigurationError
from src.config import Settings
from src.counting.counting_manager import CountingManager
from src.counting.line_counter import LineCounter
from src.detection.detector import Detector, OBJECT_CLASSES
from src.monitoring.heartbeat import HeartbeatService
from src.monitoring.metrics import RuntimeMetrics
from src.preview.encoder import JpegPreviewEncoder
from src.preview.publisher import PreviewPublisher
from src.preview.renderer import PreviewRenderer
from src.queue.event_queue import EventQueue
from src.queue.event_sender import EventSender
from src.tracking.tracker import ByteTrackTracker
from src.utils.logger import configure_logging, sanitize_error

LOGGER = logging.getLogger(__name__)


def _print_summary(settings: Settings, cameras: list[CameraRuntimeConfig], device: str) -> None:
    camera_lines = "\n".join(
        f"  - {camera.camera_id}: {camera.name}"
        for camera in cameras
    )
    print(
        "\nCCTV AI — CV SERVICE\n\n"
        f"Cameras         : {len(cameras)}\n{camera_lines}\n"
        f"Worker ID       : {settings.WORKER_ID}\n"
        f"Model           : {settings.model_path.name}\n"
        f"Device          : {device}\n"
        f"Object Classes  : {', '.join(OBJECT_CLASSES.values())}\n"
        f"API             : {settings.api_base_url}\n"
        f"Runtime         : headless\n"
        f"Dashboard preview: {'enabled' if settings.LIVE_PREVIEW_ENABLED else 'disabled'}\n\n"
        "Initializing cameras...\n",
        flush=True,
    )


def run() -> int:
    try:
        settings = Settings()
    except ValidationError as exc:
        print(f"Invalid CV service configuration:\n{exc}", file=sys.stderr)
        return 2

    configure_logging(settings.LOG_LEVEL)
    stop_event = threading.Event()

    def request_shutdown(signum: int, _frame: object) -> None:
        LOGGER.info("Shutdown requested signal=%s", signal.Signals(signum).name)
        stop_event.set()

    signal.signal(signal.SIGINT, request_shutdown)
    signal.signal(signal.SIGTERM, request_shutdown)

    queue = EventQueue(
        settings.queue_database_path,
        settings.EVENT_QUEUE_MAX_PENDING,
        settings.EVENT_QUEUE_RETAIN_DELIVERED,
    )
    api = APIClient(
        settings.api_base_url,
        settings.CV_SERVICE_TOKEN.get_secret_value(),
        settings.API_TIMEOUT_SECONDS,
    )

    try:
        camera_configs = load_camera_configs(settings)
        inference_lock = threading.Lock()
        runtimes: list[CameraRuntime] = []
        selected_device = "unknown"
        for camera in camera_configs:
            try:
                api_config = api.get_camera_config(camera.camera_id)
                if api_config.get("countingLine") is None:
                    LOGGER.info("Using local counting line camera_id=%s", camera.camera_id)
                LOGGER.info("Fastify camera registration verified camera_id=%s", camera.camera_id)
            except CameraConfigurationError as exc:
                LOGGER.error(
                    "Skipping logical camera because Fastify registration is unavailable "
                    "camera_id=%s error=%s",
                    camera.camera_id,
                    sanitize_error(exc),
                )
                continue
            except httpx.HTTPError as exc:
                LOGGER.warning(
                    "Fastify unavailable while validating camera camera_id=%s error=%s",
                    camera.camera_id,
                    sanitize_error(exc),
                )

            detector = Detector(settings.model_path, settings.DEVICE)
            selected_device = detector.device
            tracker = ByteTrackTracker(
                detector,
                settings.CONFIDENCE_THRESHOLD,
                settings.IOU_THRESHOLD,
                camera.image_size,
                inference_lock,
            )
            line_counter = LineCounter(
                camera.line,
                camera.margin_pixels,
                camera.direction_in,
                camera.anchor,
            )
            counting = CountingManager(camera.camera_id, line_counter)
            renderer = PreviewRenderer(camera.camera_id, line_counter, camera.direction_in)
            capture = RTSPCapture(
                camera.rtsp_url.get_secret_value(),
                settings.RTSP_TRANSPORT,
                settings.RTSP_CONNECT_TIMEOUT_MS,
                settings.RTSP_READ_TIMEOUT_MS,
                settings.RTSP_RECONNECT_INITIAL_SECONDS,
                settings.RTSP_RECONNECT_MAX_SECONDS,
                stop_event,
            )
            metrics = RuntimeMetrics()
            preview_publisher = (
                PreviewPublisher(
                    settings.preview_ws_url,
                    settings.CV_SERVICE_TOKEN.get_secret_value(),
                    camera.camera_id,
                    settings.WORKER_ID,
                    settings.CV_PREVIEW_RECONNECT_INITIAL_SECONDS,
                    settings.CV_PREVIEW_RECONNECT_MAX_SECONDS,
                    stop_event,
                )
                if settings.LIVE_PREVIEW_ENABLED
                else None
            )
            preview_encoder = (
                JpegPreviewEncoder(
                    camera.live_preview_width,
                    camera.live_preview_jpeg_quality,
                    settings.LIVE_PREVIEW_MAX_FRAME_BYTES,
                )
                if settings.LIVE_PREVIEW_ENABLED
                else None
            )
            worker = CameraWorker(
                camera.camera_id,
                capture,
                tracker,
                counting,
                queue,
                metrics,
                camera.target_processing_fps,
                settings.METRICS_INTERVAL_SECONDS,
                renderer,
                camera.live_preview_fps,
                preview_encoder,
                preview_publisher,
                stop_event,
            )
            heartbeat = HeartbeatService(
                api,
                settings.WORKER_ID,
                camera.camera_id,
                capture.is_connected,
                settings.HEARTBEAT_INTERVAL_SECONDS,
                stop_event,
            )
            worker_thread = threading.Thread(
                target=worker.run,
                name=f"camera-worker-{camera.camera_id}",
                daemon=True,
            )
            runtimes.append(CameraRuntime(
                camera.camera_id,
                capture,
                worker,
                heartbeat,
                preview_publisher,
                worker_thread,
            ))

        if not runtimes:
            raise CameraConfigurationError("No enabled logical cameras are runnable")

        manager = CameraManager(runtimes, stop_event)
        sender = EventSender(
            queue,
            api,
            stop_event,
            settings.EVENT_RETRY_INITIAL_SECONDS,
            settings.EVENT_RETRY_MAX_SECONDS,
        )
        _print_summary(settings, camera_configs, selected_device)
        sender.start()
        try:
            manager.run()
        finally:
            stop_event.set()
            manager.join()
            sender.join()
    except (APIAuthenticationError, CameraConfigurationError, ValueError) as exc:
        LOGGER.critical("Startup rejected by Fastify: %s", sanitize_error(exc))
        return 2
    except Exception:
        LOGGER.exception("CV service failed")
        return 1
    finally:
        api.close()
        queue.close()
        LOGGER.info("CV service stopped; unsent events remain durable")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
