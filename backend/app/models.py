from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Vector2(BaseModel):
    x: float
    y: float


class InterceptorSite(BaseModel):
    id: int
    position: Vector2
    supported_layers: list[str] = Field(default_factory=lambda: ["medium"])


class DefendedTarget(BaseModel):
    id: int
    name: str
    position: Vector2


class LaunchRequest(BaseModel):
    speed: float = Field(default=62.0, gt=0.0)
    angle_deg: float = Field(default=42.0, gt=1.0, lt=89.0)
    target_id: int | None = None


class SimulationConfig(BaseModel):
    dt: float = 0.05
    gravity: Vector2 = Vector2(x=0.0, y=-9.81)
    target_start: Vector2 = Vector2(x=-260.0, y=0.0)
    launch_sites: list[Vector2] = Field(
        default_factory=lambda: [
            Vector2(x=-260.0, y=0.0),
            Vector2(x=-320.0, y=0.0),
        ]
    )
    interceptor_sites: list[InterceptorSite] = Field(
        default_factory=lambda: [
            InterceptorSite(
                id=1,
                position=Vector2(x=80.0, y=0.0),
                supported_layers=["short", "medium", "hypersonic"],
            ),
            InterceptorSite(
                id=2,
                position=Vector2(x=128.0, y=0.0),
                supported_layers=["medium", "hypersonic"],
            ),
        ]
    )
    defended_targets: list[DefendedTarget] = Field(
        default_factory=lambda: [
            DefendedTarget(id=1, name="Alpha Site", position=Vector2(x=32.0, y=28.0)),
            DefendedTarget(id=2, name="Bravo Depot", position=Vector2(x=146.0, y=74.0)),
        ]
    )
    radar_pos: Vector2 = Vector2(x=100.0, y=25.0)
    radar_range: float = 240.0
    targeted_strike_speed: float = 168.0
    targeted_strike_angle_deg: float = 26.0
    target_patrol_speed: float = 10.0
    target_patrol_span: float = 34.0
    target_hit_radius: float = 8.0
    alpha_orbit_radius_x: float = 26.0
    alpha_orbit_radius_y: float = 10.0
    alpha_orbit_angular_speed: float = 0.42
    short_range_interceptor_speed: float = 92.0
    short_range_interceptor_turn_accel: float = 165.0
    short_range_interceptor_max_range: float = 120.0
    short_range_interceptor_max_altitude: float = 70.0
    medium_range_interceptor_speed: float = 135.0
    medium_range_interceptor_turn_accel: float = 175.0
    medium_range_interceptor_max_range: float = 240.0
    medium_range_interceptor_max_altitude: float = 220.0
    hypersonic_threat_speed_threshold: float = 140.0
    hypersonic_interceptor_speed: float = 255.0
    hypersonic_interceptor_turn_accel: float = 340.0
    hypersonic_interceptor_max_range: float = 300.0
    hypersonic_interceptor_max_altitude: float = 240.0
    intercept_radius: float = 7.0
    max_concurrent_interceptors: int = 12
    site_cooldown_seconds: float = 0.35
    max_active_interceptors_per_site: int = 5


class TrackEstimate(BaseModel):
    threat_id: int
    detected: bool = False
    track_locked: bool = False
    position: Vector2 | None = None
    velocity: Vector2 | None = None
    last_detection_time: float | None = None


class BodyState(BaseModel):
    id: int | None = None
    active: bool = False
    destroyed: bool = False
    assigned_target_id: int | None = None
    launcher_site_id: int | None = None
    interceptor_class: str | None = None
    intended_target_id: int | None = None
    position: Vector2 | None = None
    velocity: Vector2 | None = None
    trail: list[Vector2] = Field(default_factory=list)


class TargetState(BaseModel):
    id: int
    name: str
    position: Vector2
    velocity: Vector2
    destroyed: bool = False


class SimulationState(BaseModel):
    time: float
    status: str
    phase: Literal["idle", "search", "tracking", "engaging", "success", "failure"]
    threats: list[BodyState] = Field(default_factory=list)
    interceptors: list[BodyState] = Field(default_factory=list)
    radar_tracks: list[TrackEstimate] = Field(default_factory=list)
    predicted_intercepts: list[Vector2] = Field(default_factory=list)
    targets: list[TargetState] = Field(default_factory=list)
    active_threat_count: int = 0
    active_interceptor_count: int = 0
    intercepted_count: int = 0
    impacted_count: int = 0
    destroyed_target_count: int = 0
    config: SimulationConfig
