from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import numpy as np


@dataclass
class RadarTracker:
    pos: np.ndarray
    range_limit: float
    detected: bool = False
    track_locked: bool = False
    samples: deque[tuple[float, np.ndarray]] = field(
        default_factory=lambda: deque(maxlen=8)
    )
    estimated_pos: np.ndarray | None = None
    estimated_vel: np.ndarray | None = None
    last_detection_time: float | None = None

    def update(self, sim_time: float, threat_pos: np.ndarray, threat_active: bool) -> None:
        if not threat_active:
            return
        if np.linalg.norm(threat_pos - self.pos) > self.range_limit:
            return

        self.detected = True
        self.last_detection_time = sim_time

        measured_pos = threat_pos + np.random.normal(0.0, 0.8, size=2)
        self.samples.append((sim_time, measured_pos))
        if len(self.samples) < 3:
            self.estimated_pos = measured_pos
            return

        times = np.array([item[0] for item in self.samples])
        positions = np.array([item[1] for item in self.samples])
        fit_x = np.polyfit(times, positions[:, 0], 1)
        fit_y = np.polyfit(times, positions[:, 1], 1)

        self.estimated_pos = np.array(
            [np.polyval(fit_x, sim_time), np.polyval(fit_y, sim_time)]
        )
        self.estimated_vel = np.array([fit_x[0], fit_y[0]])
        self.track_locked = True

