from __future__ import annotations

import threading
import unittest
from types import SimpleNamespace

from src.camera.person_capture_control import (
    PersonCaptureRecordingControl,
    PersonCaptureRecordingControlService,
)
from src.counting.counting_manager import CountingManager
from src.tracking.tracker import TrackedObject


class FakeLineCounter:
    def __init__(self, crossing: object) -> None:
        self.crossing = crossing
        self.update_calls = 0
        self.reset_calls = 0

    def update(self, tracks: list[TrackedObject], _frame_shape: tuple[int, ...]) -> list[object]:
        self.update_calls += 1
        return [self.crossing] if tracks else []

    def reset(self) -> None:
        self.reset_calls += 1


class FakeApi:
    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled

    def get_camera_config(self, _camera_id: str) -> dict[str, object]:
        return {"personCaptureRecordingEnabled": self.enabled}


class PersonCaptureRecordingTests(unittest.TestCase):
    def test_counting_creates_event_when_person_capture_is_disabled(self) -> None:
        capture_control = PersonCaptureRecordingControl(enabled=False)
        track = TrackedObject(7, "person", 0.91, (10.0, 10.0, 40.0, 80.0))
        line = FakeLineCounter(SimpleNamespace(track=track, direction="in"))
        manager = CountingManager("cam-001", line)  # type: ignore[arg-type]

        self.assertFalse(capture_control.is_enabled())
        events = manager.process([track], (720, 1280, 3), "session-1")

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].cameraId, "cam-001")
        self.assertEqual(events[0].trackId, 7)
        self.assertEqual(manager.counters[("person", "in")], 1)

    def test_control_service_applies_api_state(self) -> None:
        api = FakeApi(enabled=False)
        control = PersonCaptureRecordingControl(enabled=True)
        service = PersonCaptureRecordingControlService(
            api,  # type: ignore[arg-type]
            "cam-001",
            control,
            2,
            threading.Event(),
        )

        service._refresh()
        self.assertFalse(control.is_enabled())
        api.enabled = True
        service._refresh()
        self.assertTrue(control.is_enabled())


if __name__ == "__main__":
    unittest.main()
