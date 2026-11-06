from __future__ import annotations

import errno
import logging
import os
import select
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit

import cv2
import numpy as np

from src.utils.logger import sanitize_error, sanitize_rtsp_url

LOGGER = logging.getLogger(__name__)
MACOS_VLC = Path("/Applications/VLC.app/Contents/MacOS/VLC")
VLC_FALLBACK_WIDTH = 1280
VLC_FALLBACK_HEIGHT = 720
VLC_FALLBACK_FPS = 10


class CaptureHandle(Protocol):
    def isOpened(self) -> bool: ...
    def read(self) -> tuple[bool, np.ndarray | None]: ...
    def release(self) -> None: ...
    def set(self, property_id: int, value: float) -> bool: ...
    def getBackendName(self) -> str: ...


class VLCRawCapture:
    """Read fixed-size RGB frames produced by a headless VLC process through stdout."""

    def __init__(
        self,
        process: subprocess.Popen[bytes],
        width: int,
        height: int,
        read_timeout_seconds: float,
        stop_event: threading.Event,
    ) -> None:
        self._process = process
        self._width = width
        self._height = height
        self._frame_size = width * height * 3
        self._read_timeout = read_timeout_seconds
        self._stop_event = stop_event
        self._prefetched: np.ndarray | None = None

    def isOpened(self) -> bool:
        return self._process.poll() is None and self._process.stdout is not None

    def _read_frame(self) -> tuple[bool, np.ndarray | None]:
        stdout = self._process.stdout
        if stdout is None:
            return False, None
        deadline = time.monotonic() + self._read_timeout
        data = bytearray()
        while len(data) < self._frame_size and not self._stop_event.is_set():
            remaining = deadline - time.monotonic()
            if remaining <= 0 or self._process.poll() is not None:
                return False, None
            readable, _, _ = select.select([stdout], [], [], min(remaining, 0.5))
            if not readable:
                continue
            chunk = os.read(stdout.fileno(), min(1_048_576, self._frame_size - len(data)))
            if not chunk:
                return False, None
            data.extend(chunk)
        if len(data) != self._frame_size:
            return False, None
        rgb = np.frombuffer(data, dtype=np.uint8).reshape(self._height, self._width, 3)
        return True, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    def prime(self) -> bool:
        ok, frame = self._read_frame()
        self._prefetched = frame if ok else None
        return ok

    def read(self) -> tuple[bool, np.ndarray | None]:
        if self._prefetched is not None:
            frame = self._prefetched
            self._prefetched = None
            return True, frame
        return self._read_frame()

    def release(self) -> None:
        self._prefetched = None

    def set(self, _property_id: int, _value: float) -> bool:
        return False

    def getBackendName(self) -> str:
        return "VLC_RAW_PIPE"


@dataclass(frozen=True)
class LatestFrame:
    image: np.ndarray
    sequence: int
    connection_generation: int
    captured_monotonic: float


class RTSPCapture:
    """A reconnecting, latest-frame RTSP reader isolated from inference latency."""

    def __init__(
        self,
        url: str,
        transport: str,
        connect_timeout_ms: int,
        read_timeout_ms: int,
        reconnect_initial: float,
        reconnect_max: float,
        stop_event: threading.Event,
    ) -> None:
        self._url = url
        self._safe_url = sanitize_rtsp_url(url)
        endpoint = urlsplit(url)
        self._host = endpoint.hostname or ""
        self._port = endpoint.port or 554
        self._transport = transport
        self._connect_timeout_ms = connect_timeout_ms
        self._read_timeout_ms = read_timeout_ms
        self._reconnect_initial = reconnect_initial
        self._reconnect_max = reconnect_max
        self._stop_event = stop_event
        self._lock = threading.Lock()
        self._capture: CaptureHandle | None = None
        self._vlc_process: subprocess.Popen[bytes] | None = None
        self._vlc_playlist: Path | None = None
        self._vlc_stderr_tail: deque[str] = deque(maxlen=8)
        self._vlc_stderr_thread: threading.Thread | None = None
        self._latest: LatestFrame | None = None
        self._sequence = 0
        self._generation = 0
        self._connected = False
        self._last_failure_category = "none"
        self._thread = threading.Thread(target=self._run, name="rtsp-capture", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def join(self, timeout: float = 15) -> None:
        self.release()
        self._thread.join(timeout)
        if self._thread.is_alive():
            LOGGER.warning("RTSP reader did not stop before shutdown timeout")

    def _tcp_preflight(self) -> bool:
        """Verify the RTSP control socket before asking FFmpeg to open the stream."""
        timeout = min(self._connect_timeout_ms / 1000, 5.0)
        try:
            with socket.create_connection((self._host, self._port), timeout=timeout):
                LOGGER.debug("RTSP TCP preflight succeeded host=%s port=%d", self._host, self._port)
                return True
        except socket.gaierror as exc:
            self._last_failure_category = "network_dns_failure"
            LOGGER.error(
                "RTSP network DNS failure host=%s port=%d error=%s",
                self._host,
                self._port,
                exc.strerror or "name resolution failed",
            )
        except (TimeoutError, socket.timeout):
            self._last_failure_category = "network_timeout"
            LOGGER.error(
                "RTSP network timeout host=%s port=%d timeout_seconds=%.1f",
                self._host,
                self._port,
                timeout,
            )
        except ConnectionRefusedError:
            self._last_failure_category = "network_connection_refused"
            LOGGER.error("RTSP TCP connection refused host=%s port=%d", self._host, self._port)
        except OSError as exc:
            if exc.errno in {errno.EHOSTUNREACH, errno.ENETUNREACH, errno.EACCES, errno.EPERM}:
                self._last_failure_category = "network_route_or_permission_denied"
                LOGGER.warning(
                    "RTSP network route/permission failure host=%s port=%d errno=%s error=%s. "
                    "On macOS, verify Local Network permission for the terminal/IDE/process host "
                    "and check VPN or network-filter rules; VLC has a separate permission.",
                    self._host,
                    self._port,
                    exc.errno,
                    exc.strerror or "network access denied",
                )
            else:
                self._last_failure_category = "network_socket_failure"
                LOGGER.error(
                    "RTSP network socket failure host=%s port=%d errno=%s error=%s",
                    self._host,
                    self._port,
                    exc.errno,
                    exc.strerror or "socket failure",
                )
        return False

    def _open(self) -> CaptureHandle | None:
        preflight_ok = self._tcp_preflight()
        preflight_failure = self._last_failure_category
        vlc_attempted = False
        if not preflight_ok:
            LOGGER.warning(
                "RTSP TCP preflight failed category=%s",
                preflight_failure,
            )
        # VLC has its own macOS Local Network permission. When Python receives EHOSTUNREACH,
        # attempting OpenCV/FFmpeg first only repeats the same native network failure.
        if preflight_failure == "network_route_or_permission_denied":
            vlc_attempted = True
            vlc_capture = self._open_via_vlc()
            if vlc_capture is not None:
                return vlc_capture
            LOGGER.warning("VLC fallback failed; making a final direct FFmpeg attempt")

        if not cv2.videoio_registry.hasBackend(cv2.CAP_FFMPEG):
            self._last_failure_category = "backend_unavailable"
            LOGGER.error("OpenCV FFmpeg capture backend is unavailable")
            return None

        # FFmpeg 7 / avformat 61 uses `timeout` (microseconds) for socket I/O.
        # CAP_PROP_OPEN_TIMEOUT_MSEC independently bounds the RTSP handshake.
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
            f"rtsp_transport;{self._transport}|timeout;{self._read_timeout_ms * 1000}"
        )
        params = [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
            self._connect_timeout_ms,
            cv2.CAP_PROP_READ_TIMEOUT_MSEC,
            self._read_timeout_ms,
        ]
        started = time.monotonic()
        try:
            capture = cv2.VideoCapture(self._url, cv2.CAP_FFMPEG, params)
        except (TypeError, cv2.error) as exc:
            self._last_failure_category = "backend_open_exception"
            LOGGER.error(
                "OpenCV FFmpeg open exception url=%s error_type=%s",
                self._safe_url,
                type(exc).__name__,
            )
            return None
        if not capture.isOpened():
            capture.release()
            self._last_failure_category = (
                f"{preflight_failure}+rtsp_open_failed"
                if not preflight_ok
                else "rtsp_open_failed"
            )
            LOGGER.error(
                "RTSP protocol open failed url=%s backend=FFMPEG transport=%s "
                "preflight_ok=%s elapsed_ms=%d; check process LAN permission, camera "
                "credentials, RTSP path, camera session limits, and codec support",
                self._safe_url,
                self._transport,
                preflight_ok,
                round((time.monotonic() - started) * 1000),
            )
            if preflight_failure == "network_route_or_permission_denied" and not vlc_attempted:
                return self._open_via_vlc()
            return None
        self._last_failure_category = "none"
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        LOGGER.info(
            "RTSP protocol open succeeded url=%s backend=%s transport=%s elapsed_ms=%d",
            self._safe_url,
            capture.getBackendName(),
            self._transport,
            round((time.monotonic() - started) * 1000),
        )
        return capture

    @staticmethod
    def _vlc_executable() -> str | None:
        if MACOS_VLC.is_file():
            return str(MACOS_VLC)
        return shutil.which("vlc") or shutil.which("cvlc")

    def _cleanup_vlc(self) -> None:
        with self._lock:
            process = self._vlc_process
            playlist = self._vlc_playlist
            stderr_thread = self._vlc_stderr_thread
            self._vlc_process = None
            self._vlc_playlist = None
            self._vlc_stderr_thread = None
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        if stderr_thread is not None:
            stderr_thread.join(timeout=1)
        if playlist is not None:
            try:
                playlist.unlink(missing_ok=True)
            except OSError:
                LOGGER.warning("Unable to remove temporary VLC playlist")

    def _drain_vlc_stderr(self, process: subprocess.Popen[bytes]) -> None:
        if process.stderr is None:
            return
        for raw_line in iter(process.stderr.readline, b""):
            line = sanitize_error(raw_line.decode("utf-8", errors="replace").strip())
            if line:
                self._vlc_stderr_tail.append(line)

    def _open_via_vlc(self) -> CaptureHandle | None:
        """Use VLC's authorized LAN access and pipe decoded RGB frames in memory."""
        executable = self._vlc_executable()
        if executable is None:
            self._last_failure_category = "vlc_fallback_unavailable"
            LOGGER.error("VLC fallback unavailable; VLC executable was not found")
            return None

        descriptor, playlist_name = tempfile.mkstemp(prefix="cctv-rtsp-", suffix=".m3u")
        playlist = Path(playlist_name)
        try:
            os.fchmod(descriptor, 0o600)
            handle = os.fdopen(descriptor, "w", encoding="utf-8")
            descriptor = -1
            with handle:
                handle.write("#EXTM3U\n")
                handle.write(self._url)
                handle.write("\n")
        except Exception:
            if descriptor >= 0:
                os.close(descriptor)
            playlist.unlink(missing_ok=True)
            raise

        sout = (
            f"#transcode{{vcodec=RV24,acodec=none,width={VLC_FALLBACK_WIDTH},"
            f"height={VLC_FALLBACK_HEIGHT},fps={VLC_FALLBACK_FPS}}}:"
            "standard{access=file,mux=raw,dst=-}"
        )
        command = [
            executable,
            "-I",
            "dummy",
            "--no-video-title-show",
            "--no-audio",
            "--rtsp-tcp",
            "--network-caching=300",
            str(playlist),
            f"--sout={sout}",
            "--sout-keep",
        ]
        LOGGER.warning(
            "Starting credential-safe VLC raw-frame fallback url=%s output=%dx%d@%dfps",
            self._safe_url,
            VLC_FALLBACK_WIDTH,
            VLC_FALLBACK_HEIGHT,
            VLC_FALLBACK_FPS,
        )
        self._vlc_stderr_tail.clear()
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                close_fds=True,
            )
        except OSError as exc:
            playlist.unlink(missing_ok=True)
            self._last_failure_category = "vlc_fallback_start_failed"
            LOGGER.error("VLC fallback failed to start error=%s", exc.strerror or "process error")
            return None

        with self._lock:
            self._vlc_process = process
            self._vlc_playlist = playlist
            self._vlc_stderr_thread = threading.Thread(
                target=self._drain_vlc_stderr,
                args=(process,),
                name="vlc-stderr",
                daemon=True,
            )
            self._vlc_stderr_thread.start()

        capture = VLCRawCapture(
            process,
            VLC_FALLBACK_WIDTH,
            VLC_FALLBACK_HEIGHT,
            self._read_timeout_ms / 1000,
            self._stop_event,
        )
        if not capture.prime():
            self._last_failure_category = "vlc_fallback_capture_failed"
            LOGGER.error(
                "VLC raw-frame fallback produced no complete frame process_exit=%s diagnostic=%s",
                process.poll(),
                " | ".join(self._vlc_stderr_tail) or "no VLC diagnostic output",
            )
            self._cleanup_vlc()
            return None

        playlist.unlink(missing_ok=True)
        with self._lock:
            self._vlc_playlist = None
        self._last_failure_category = "none"
        LOGGER.info(
            "RTSP opened through VLC fallback backend=%s frame_size=%dx%d",
            capture.getBackendName(),
            VLC_FALLBACK_WIDTH,
            VLC_FALLBACK_HEIGHT,
        )
        return capture

    def _set_disconnected(self) -> None:
        with self._lock:
            was_connected = self._connected
            self._connected = False
        if was_connected:
            if self._stop_event.is_set():
                LOGGER.info("RTSP stream stopped url=%s", self._safe_url)
            else:
                LOGGER.warning("RTSP stream disconnected url=%s", self._safe_url)

    def _run(self) -> None:
        delay = self._reconnect_initial
        attempts = 0
        while not self._stop_event.is_set():
            attempts += 1
            LOGGER.info(
                "Connecting to RTSP stream url=%s host=%s port=%d transport=%s "
                "backend=AUTO open_timeout_ms=%d read_timeout_ms=%d attempt=%d",
                self._safe_url,
                self._host,
                self._port,
                self._transport,
                self._connect_timeout_ms,
                self._read_timeout_ms,
                attempts,
            )
            try:
                capture = self._open()
            except cv2.error as exc:
                self._last_failure_category = "backend_open_exception"
                LOGGER.error(
                    "RTSP backend failure url=%s error_type=%s", self._safe_url, type(exc).__name__
                )
                capture = None
            with self._lock:
                self._capture = capture
            if capture is None or not capture.isOpened():
                if capture is not None:
                    capture.release()
                with self._lock:
                    self._capture = None
                LOGGER.warning(
                    "RTSP connection unavailable category=%s retry_in=%.1fs url=%s",
                    self._last_failure_category,
                    delay,
                    self._safe_url,
                )
                self._stop_event.wait(delay)
                delay = min(self._reconnect_max, delay * 2)
                continue

            with self._lock:
                self._generation += 1
                self._connected = True
            LOGGER.info("RTSP stream connected url=%s generation=%d", self._safe_url, self._generation)
            delay = self._reconnect_initial
            attempts = 0

            while not self._stop_event.is_set():
                ok, frame = capture.read()
                if not ok or frame is None:
                    if self._stop_event.is_set():
                        break
                    self._last_failure_category = "rtsp_read_failed"
                    LOGGER.error(
                        "RTSP frame read failed url=%s backend=%s read_timeout_ms=%d",
                        self._safe_url,
                        capture.getBackendName(),
                        self._read_timeout_ms,
                    )
                    self._set_disconnected()
                    break
                now = time.monotonic()
                with self._lock:
                    self._sequence += 1
                    self._latest = LatestFrame(frame, self._sequence, self._generation, now)

            capture.release()
            self._cleanup_vlc()
            with self._lock:
                if self._capture is capture:
                    self._capture = None
            if not self._stop_event.is_set():
                LOGGER.info("Reconnecting RTSP stream in %.1fs", delay)
                self._stop_event.wait(delay)
                delay = min(self._reconnect_max, delay * 2)
        self._set_disconnected()

    def latest(self, after_sequence: int) -> LatestFrame | None:
        with self._lock:
            if self._latest is None or self._latest.sequence <= after_sequence:
                return None
            return self._latest

    def is_connected(self) -> bool:
        with self._lock:
            if (
                not self._connected
                or self._latest is None
                or self._latest.connection_generation != self._generation
            ):
                return False
            max_age = max(self._read_timeout_ms / 1000 * 1.5, 2.0)
            return time.monotonic() - self._latest.captured_monotonic <= max_age

    def release(self) -> None:
        with self._lock:
            capture = self._capture
        if capture is not None:
            capture.release()
        self._cleanup_vlc()
