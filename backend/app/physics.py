from __future__ import annotations

from dataclasses import dataclass, field
from math import cos, radians, sin

import numpy as np


def vec(x: float, y: float) -> np.ndarray:
    return np.array([x, y], dtype=float)


def build_launch_velocity(speed: float, angle_deg: float) -> np.ndarray:
    angle = radians(angle_deg)
    return vec(speed * cos(angle), speed * sin(angle))


@dataclass
class BallisticThreat:
    pos: np.ndarray
    vel: np.ndarray
    active: bool = True
    trail: list[np.ndarray] = field(default_factory=list)
    maneuver: bool = False
    revector_done: bool = False
    aim_point: np.ndarray | None = None
    terminal_homing: bool = False
    max_turn_accel: float = 180.0
    guided_speed: float | None = None

    def step(self, dt: float, gravity: np.ndarray) -> None:
        if not self.active:
            return
        if (
            self.maneuver
            and not self.revector_done
            and self.vel[1] <= 0.0
            and self.pos[1] > 20.0
            and self.aim_point is not None
        ):
            direction = self.aim_point - self.pos
            direction_norm = np.linalg.norm(direction)
            if direction_norm > 1e-6:
                new_speed = np.linalg.norm(self.vel) * 1.15
                self.vel = direction / direction_norm * new_speed
                self.revector_done = True
        if self.terminal_homing and self.revector_done and self.aim_point is not None:
            desired = self.aim_point - self.pos
            desired_norm = np.linalg.norm(desired)
            if desired_norm > 1e-6:
                speed = max(np.linalg.norm(self.vel), self.guided_speed or 0.0)
                desired_vel = desired / desired_norm * max(speed, 1e-6)
                accel = (desired_vel - self.vel) / max(dt, 1e-6)
                accel_norm = np.linalg.norm(accel)
                if accel_norm > self.max_turn_accel:
                    accel = accel / accel_norm * self.max_turn_accel
                self.vel = self.vel + accel * dt
                vel_norm = np.linalg.norm(self.vel)
                if vel_norm > 1e-6:
                    self.vel = self.vel / vel_norm * max(speed, 1e-6)
        else:
            self.vel = self.vel + gravity * dt
        self.pos = self.pos + self.vel * dt
        self.trail.append(self.pos.copy())
        if self.pos[1] < 0.0 and self.vel[1] < 0.0:
            self.active = False


@dataclass
class Interceptor:
    pos: np.ndarray
    speed: float
    max_turn_accel: float
    active: bool = False
    vel: np.ndarray = field(default_factory=lambda: vec(0.0, 0.0))
    trail: list[np.ndarray] = field(default_factory=list)

    def launch(self, aim_direction: np.ndarray) -> None:
        direction_norm = np.linalg.norm(aim_direction)
        if direction_norm < 1e-6:
            return
        self.active = True
        self.vel = aim_direction / direction_norm * self.speed
        self.trail = [self.pos.copy()]

    def step(self, dt: float, aim_point: np.ndarray) -> None:
        if not self.active:
            return
        desired = aim_point - self.pos
        desired_norm = np.linalg.norm(desired)
        if desired_norm > 1e-6:
            desired_vel = desired / desired_norm * self.speed
            accel = (desired_vel - self.vel) / max(dt, 1e-6)
            accel_norm = np.linalg.norm(accel)
            if accel_norm > self.max_turn_accel:
                accel = accel / accel_norm * self.max_turn_accel
            self.vel = self.vel + accel * dt
            self.vel = self.vel / max(np.linalg.norm(self.vel), 1e-6) * self.speed
        self.pos = self.pos + self.vel * dt
        self.trail.append(self.pos.copy())
