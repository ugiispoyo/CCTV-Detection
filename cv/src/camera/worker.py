from __future__ import annotations

import logging
import threading
import time
from collections import Counter

from src.camera.rtsp import RTSPCapture
from src.counting.counting_manager import CountingManager
from src.monitoring.metrics import RuntimeMetrics
from src.preview.encoder import JpegPreviewEncoder
from src.preview.publisher import PreviewPublisher
from src.preview.renderer import PreviewRenderer
from src.queue.event_queue import EventQueue
from src.tracking.tracker import ByteTrackTracker

LOGGER = logging.getLogger(__name__)
class CameraWorker:
    def __init__(
        self,
        camera_id: str,
        capture: RTSPCapture,
        tracker: ByteTrackTracker,
        counting: CountingManager,
        event_queue: EventQueue,
        metrics: RuntimeMetrics,
        target_fps: float,
        metrics_interval: float,
        renderer: PreviewRenderer,
        live_preview_fps: float,
        preview_encoder: JpegPreviewEncoder | None,
        preview_publisher: PreviewPublisher | None,
        stop_event: threading.Event,
    ) -> None:
        self._camera_id = camera_id
        self._capture = capture
        self._tracker = tracker
        self._counting = counting
        self._queue = event_queue
        self._metrics = metrics
        self._frame_interval = 1 / target_fps
        self._metrics_interval = metrics_interval
        self._renderer = renderer
        self._live_preview_interval = 1 / live_preview_fps
        self._preview_encoder = preview_encoder
        self._preview_publisher = preview_publisher
        self._stop_event = stop_event

    def run(self) -> None:
        last_sequence = 0
        last_generation = 0
        next_process = 0.0
        next_metrics_log = time.monotonic() + self._metrics_interval
        next_live_preview = 0.0
        preview_frames = 0
        preview_encoding_ms = 0.0
        preview_window_started = time.monotonic()
        last_encoding_warning = 0.0
        while not self._stop_event.is_set():
            if self._queue.at_capacity():
                LOGGER.critical(
                    "Event queue capacity reached camera_id=%s pending=%d; pausing inference until delivery recovers",
                    self._camera_id,
                    self._queue.pending_count(),
                )
                self._stop_event.wait(2)
                continue

            now = time.monotonic()
            if now < next_process:
                self._stop_event.wait(min(next_process - now, 0.02))
                continue
            latest = self._capture.latest(last_sequence)
            if latest is None:
                self._stop_event.wait(0.02)
                continue
            last_sequence = latest.sequence
            next_process = now + self._frame_interval

            if latest.connection_generation != last_generation:
                last_generation = latest.connection_generation
                self._tracker.reset()
                self._counting.reset_tracking()

            try:
                tracks, latency_ms = self._tracker.track(latest.image)
                events = self._counting.process(
                    tracks, latest.image.shape, self._tracker.session_id
                )
                for event in events:
                    inserted = self._queue.enqueue(event)
                    if not inserted:
                        LOGGER.warning("Event already present in local queue event_id=%s", event.eventId)
                self._metrics.record_frame(latency_ms)
            except Exception:
                LOGGER.exception("Inference frame failed camera_id=%s", self._camera_id)
                continue

            snapshot = self._metrics.snapshot()
            wants_live = self._preview_publisher is not None and time.monotonic() >= next_live_preview
            if wants_live:
                try:
                    annotated = self._renderer.render(
                        latest.image,
                        tracks,
                        self._counting.counters,
                        snapshot.processing_fps,
                        self._capture.is_connected(),
                    )
                    if wants_live and self._preview_encoder is not None and self._preview_publisher is not None:
                        encoded = self._preview_encoder.encode(annotated)
                        next_live_preview = time.monotonic() + self._live_preview_interval
                        if encoded is None:
                            if time.monotonic() - last_encoding_warning >= self._metrics_interval:
                                LOGGER.warning("Live preview JPEG encoding failed or exceeded payload limit camera_id=%s", self._camera_id)
                                last_encoding_warning = time.monotonic()
                        else:
                            preview_frames += 1
                            preview_encoding_ms = encoded.encoding_latency_ms
                            visible = Counter(track.object_type for track in tracks)
                            self._preview_publisher.submit(encoded, {
                                "person": visible["person"],
                                "car": visible["car"],
                                "motorcycle": visible["motorcycle"],
                            })
                except Exception:
                    LOGGER.exception("Live preview rendering failed camera_id=%s", self._camera_id)

            if time.monotonic() >= next_metrics_log:
                preview_elapsed = max(time.monotonic() - preview_window_started, 0.001)
                LOGGER.info(
                    "Performance camera_id=%s processing_fps=%.2f inference_ms=%.1f preview_fps=%.2f "
                    "preview_encoding_ms=%.1f preview_dropped=%d queue_pending=%d queue_invalid=%d",
                    self._camera_id,
                    snapshot.processing_fps,
                    snapshot.inference_latency_ms,
                    preview_frames / preview_elapsed,
                    preview_encoding_ms,
                    self._preview_publisher.dropped_frames() if self._preview_publisher else 0,
                    self._queue.pending_count(),
                    self._queue.invalid_count(),
                )
                preview_frames = 0
                preview_window_started = time.monotonic()
                next_metrics_log = time.monotonic() + self._metrics_interval

