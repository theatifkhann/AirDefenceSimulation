from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from time import monotonic

import numpy as np

from .guidance import solve_intercept_time
from .models import (
    BodyState,
    SimulationConfig,
    SimulationState,
    TargetState,
    TrackEstimate,
    Vector2,
)
from .physics import BallisticThreat, Interceptor, build_launch_velocity, vec


@dataclass
class ThreatRecord:
    id: int
    body: BallisticThreat
    intended_target_id: int | None = None
    target_strike: bool = False
    destroyed: bool = False
    impacted: bool = False


@dataclass
class DefendedTargetRecord:
    id: int
    name: str
    position: np.ndarray
    velocity: np.ndarray
    anchor_position: np.ndarray
    patrol_span: float
    patrol_phase: float
    destroyed: bool = False


@dataclass
class InterceptorRecord:
    id: int
    target_id: int
    launcher_site_id: int
    interceptor_class: str
    body: Interceptor
    destroyed_target: bool = False
    predicted_intercept: np.ndarray | None = None
    predicted_time_to_go: float | None = None


@dataclass
class RadarTrackRecord:
    threat_id: int
    detected: bool = False
    track_locked: bool = False
    samples: deque[tuple[float, np.ndarray]] = field(
        default_factory=lambda: deque(maxlen=8)
    )
    estimated_pos: np.ndarray | None = None
    estimated_vel: np.ndarray | None = None
    last_detection_time: float | None = None


@dataclass
class SimulationEngine:
    config: SimulationConfig

    def __post_init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.time = 0.0
        self.last_wall_time = monotonic()
        self.status = "Ready. Launch one or more threats."
        self.phase = "idle"
        self.threats: list[ThreatRecord] = []
        self.interceptors: list[InterceptorRecord] = []
        self.radar_tracks: dict[int, RadarTrackRecord] = {}
        self.next_threat_id = 1
        self.next_interceptor_id = 1
        self.intercepted_count = 0
        self.impacted_count = 0
        self.destroyed_target_count = 0
        self.next_launch_site_index = 0
        self.targets = [
            DefendedTargetRecord(
                id=target.id,
                name=target.name,
                position=vec(target.position.x, target.position.y),
                velocity=vec(
                    self.config.target_patrol_speed * (1 if index % 2 == 0 else -1),
                    0.0,
                ),
                anchor_position=vec(target.position.x, target.position.y),
                patrol_span=max(18.0, self.config.target_patrol_span - index * 6.0),
                patrol_phase=index * 1.35,
            )
            for index, target in enumerate(self.config.defended_targets)
        ]
        self.site_last_launch_time = {
            site.id: -1e9 for site in self.config.interceptor_sites
        }

    def sync_to_wall_time(self, max_catchup_seconds: float = 0.5) -> None:
        now = monotonic()
        elapsed = max(0.0, now - self.last_wall_time)
        consumed = min(elapsed, max_catchup_seconds)
        steps = int(consumed / self.config.dt)
        remainder = consumed - steps * self.config.dt
        self.last_wall_time = now - remainder
        if steps > 0:
            self.step(steps=steps)

    def launch_threat(
        self,
        speed: float,
        angle_deg: float,
        target_id: int | None = None,
    ) -> None:
        if target_id is not None:
            target = self._find_defended_target(target_id)
            if target is None or target.destroyed:
                self.status = f"Target strike unavailable for target {target_id}."
                return
            self._launch_target_strike(target)
            self.status = (
                f"Precision strike launched on moving target {target.id} ({target.name})."
            )
            self.phase = "search"
            return

        threat = ThreatRecord(
            id=self.next_threat_id,
            body=BallisticThreat(
                pos=self._next_launch_position(),
                vel=build_launch_velocity(speed, angle_deg),
                maneuver=speed >= self.config.hypersonic_threat_speed_threshold
                and angle_deg >= 40.0,
                aim_point=vec(self.config.radar_pos.x, self.config.radar_pos.y),
            ),
            intended_target_id=target_id,
            target_strike=False,
        )
        self.next_threat_id += 1
        self.threats.append(threat)
        self.status = f"Threat {threat.id} launched. Autonomous defense searching."
        self.phase = "search"

    def launch_dual_target_strike(self) -> None:
        alive_targets = [target for target in self.targets if not target.destroyed]
        if not alive_targets:
            self.status = "No active helicopter targets remain for strike."
            return

        launched_ids: list[int] = []
        for target in alive_targets[:2]:
            self._launch_target_strike(target)
            launched_ids.append(target.id)

        self.status = (
            f"Dual precision strike launched on moving targets {', '.join(f'TG{target_id}' for target_id in launched_ids)}."
        )
        self.phase = "search"

    def _launch_target_strike(self, target: DefendedTargetRecord) -> None:
        threat = ThreatRecord(
            id=self.next_threat_id,
            body=BallisticThreat(
                pos=self._next_launch_position(),
                vel=build_launch_velocity(
                    self.config.targeted_strike_speed,
                    self.config.targeted_strike_angle_deg,
                ),
                maneuver=False,
                revector_done=True,
                aim_point=target.position.copy(),
                terminal_homing=True,
                max_turn_accel=320.0,
                guided_speed=self.config.targeted_strike_speed * 1.1,
            ),
            intended_target_id=target.id,
            target_strike=True,
        )
        self.next_threat_id += 1
        self.threats.append(threat)

    def _next_launch_position(self) -> np.ndarray:
        sites = self.config.launch_sites or [self.config.target_start]
        pos = sites[self.next_launch_site_index % len(sites)]
        self.next_launch_site_index += 1
        return vec(pos.x, pos.y)

    def step(self, steps: int = 1) -> SimulationState:
        gravity = vec(self.config.gravity.x, self.config.gravity.y)
        for _ in range(steps):
            self.time += self.config.dt
            self._update_targets()
            self._update_threats(gravity)
            self._update_tracks()
            self._auto_launch_interceptors()
            self._update_interceptors()
            self._resolve_intercepts()
            self._update_phase()
        return self.snapshot()

    def _update_targets(self) -> None:
        for target in self.targets:
            if target.destroyed:
                target.velocity = vec(0.0, 0.0)
                continue

            if target.id == 1:
                omega = self.config.alpha_orbit_angular_speed
                radius_x = self.config.alpha_orbit_radius_x
                radius_y = self.config.alpha_orbit_radius_y
                phase = self.time * omega + target.patrol_phase
                target.position[0] = target.anchor_position[0] + radius_x * np.cos(phase)
                target.position[1] = target.anchor_position[1] + radius_y * np.sin(phase)
                target.velocity[0] = -radius_x * omega * np.sin(phase)
                target.velocity[1] = radius_y * omega * np.cos(phase)
                continue

            target.position[0] = target.position[0] + target.velocity[0] * self.config.dt
            delta_x = target.position[0] - target.anchor_position[0]
            if abs(delta_x) >= target.patrol_span:
                target.position[0] = (
                    target.anchor_position[0]
                    + np.sign(delta_x) * target.patrol_span
                )
                target.velocity[0] *= -1.0

            bob_amplitude = 3.0
            bob_frequency = 0.52
            bob_value = bob_amplitude * np.sin(
                self.time * bob_frequency + target.patrol_phase
            )
            bob_velocity = bob_amplitude * bob_frequency * np.cos(
                self.time * bob_frequency + target.patrol_phase
            )
            target.position[1] = target.anchor_position[1] + bob_value
            target.velocity[1] = bob_velocity

    def _update_threats(self, gravity: np.ndarray) -> None:
        for threat in self.threats:
            if not threat.body.active:
                continue
            previous_pos = threat.body.pos.copy()
            if threat.intended_target_id is not None:
                target = self._find_defended_target(threat.intended_target_id)
                if target is not None and not target.destroyed:
                    guidance_speed = max(
                        np.linalg.norm(threat.body.vel),
                        threat.body.guided_speed or 0.0,
                    )
                    intercept_time = solve_intercept_time(
                        threat.body.pos,
                        max(guidance_speed, 1e-6),
                        target.position,
                        target.velocity,
                    )
                    if intercept_time is not None:
                        intercept_time = min(intercept_time, 1.6)
                        threat.body.aim_point = target.position + target.velocity * intercept_time
                    else:
                        threat.body.aim_point = target.position.copy()
            threat.body.step(self.config.dt, gravity)
            if threat.intended_target_id is not None:
                target = self._find_defended_target(threat.intended_target_id)
                if target is not None and not target.destroyed:
                    closest_point = self._closest_point_on_segment(
                        previous_pos,
                        threat.body.pos,
                        target.position,
                    )
                    if np.linalg.norm(closest_point - target.position) <= self.config.target_hit_radius:
                        threat.body.active = False
                        threat.destroyed = True
                        target.destroyed = True
                        target.velocity = vec(0.0, 0.0)
                        self.destroyed_target_count += 1
                        self.status = (
                            f"Threat {threat.id} achieved a direct hit on moving target {target.id} ({target.name})."
                        )
                        continue
            if not threat.body.active and not threat.destroyed:
                threat.impacted = True
                self.impacted_count += 1
                self._resolve_target_impact(threat)

    def _update_tracks(self) -> None:
        radar_pos = vec(self.config.radar_pos.x, self.config.radar_pos.y)
        for threat in self.threats:
            track = self.radar_tracks.setdefault(
                threat.id, RadarTrackRecord(threat_id=threat.id)
            )
            if not threat.body.active:
                continue
            if np.linalg.norm(threat.body.pos - radar_pos) > self.config.radar_range:
                continue

            track.detected = True
            track.last_detection_time = self.time
            measured_pos = threat.body.pos + np.random.normal(0.0, 0.8, size=2)
            track.samples.append((self.time, measured_pos))
            if len(track.samples) < 3:
                track.estimated_pos = measured_pos
                continue

            times = np.array([item[0] for item in track.samples])
            positions = np.array([item[1] for item in track.samples])
            fit_x = np.polyfit(times, positions[:, 0], 1)
            fit_y = np.polyfit(times, positions[:, 1], 1)
            track.estimated_pos = np.array(
                [np.polyval(fit_x, self.time), np.polyval(fit_y, self.time)]
            )
            track.estimated_vel = np.array([fit_x[0], fit_y[0]])
            track.track_locked = True

    def _auto_launch_interceptors(self) -> None:
        active_interceptors = [item for item in self.interceptors if item.body.active]
        if len(active_interceptors) >= self.config.max_concurrent_interceptors:
            return

        engaged_target_ids = {item.target_id for item in active_interceptors}
        for threat in self.threats:
            if (
                not threat.body.active
                or threat.id in engaged_target_ids
            ):
                continue

            track = self.radar_tracks.get(threat.id)
            if track is None or not track.track_locked:
                continue
            if track.estimated_pos is None or track.estimated_vel is None:
                continue

            site_selections = self._select_launcher_sites(
                target_pos=track.estimated_pos,
                target_vel=track.estimated_vel,
            )
            if not site_selections:
                continue
            for site_id, interceptor_class, interceptor_body, intercept_time in site_selections:
                if len(active_interceptors) >= self.config.max_concurrent_interceptors:
                    break
                predicted_intercept = track.estimated_pos + track.estimated_vel * intercept_time
                interceptor_body.launch(predicted_intercept - interceptor_body.pos)
                if not interceptor_body.active:
                    continue

                interceptor = InterceptorRecord(
                    id=self.next_interceptor_id,
                    target_id=threat.id,
                    launcher_site_id=site_id,
                    interceptor_class=interceptor_class,
                    body=interceptor_body,
                    predicted_intercept=predicted_intercept,
                    predicted_time_to_go=intercept_time,
                )
                self.next_interceptor_id += 1
                self.interceptors.append(interceptor)
                self.site_last_launch_time[site_id] = self.time
                self.status = (
                    f"{interceptor_class.capitalize()} interceptor {interceptor.id} launched from site {site_id} on threat {threat.id}."
                )

                active_interceptors.append(interceptor)
                if len(active_interceptors) >= self.config.max_concurrent_interceptors:
                    break

    def _update_interceptors(self) -> None:
        for interceptor in self.interceptors:
            if not interceptor.body.active:
                continue
            threat = self._find_threat(interceptor.target_id)
            if threat is None or not threat.body.active:
                # Continue flying toward last predicted intercept so trajectory is shown
                if interceptor.predicted_intercept is not None:
                    aim_point = interceptor.predicted_intercept
                    if (
                        np.linalg.norm(interceptor.body.pos - aim_point)
                        <= self.config.intercept_radius
                    ):
                        interceptor.body.active = False
                        continue
                    interceptor.body.step(self.config.dt, aim_point)
                    continue
                interceptor.body.active = False
                continue

            track = self.radar_tracks.get(threat.id)
            if track and track.track_locked and track.estimated_pos is not None:
                target_pos = track.estimated_pos
                target_vel = track.estimated_vel if track.estimated_vel is not None else vec(0.0, 0.0)
            else:
                target_pos = threat.body.pos
                target_vel = threat.body.vel

            intercept_time = solve_intercept_time(
                interceptor.body.pos,
                interceptor.body.speed,
                target_pos,
                target_vel,
            )
            if intercept_time is not None:
                interceptor.predicted_time_to_go = intercept_time
                interceptor.predicted_intercept = target_pos + target_vel * intercept_time
                aim_point = interceptor.predicted_intercept
            else:
                aim_point = target_pos

            interceptor.body.step(self.config.dt, aim_point)

    def _resolve_intercepts(self) -> None:
        for interceptor in self.interceptors:
            if not interceptor.body.active:
                continue
            threat = self._find_threat(interceptor.target_id)
            if threat is None or not threat.body.active:
                continue

            separation = np.linalg.norm(threat.body.pos - interceptor.body.pos)
            if separation <= self.config.intercept_radius:
                threat.body.active = False
                threat.destroyed = True
                interceptor.body.active = False
                interceptor.destroyed_target = True
                self.intercepted_count += 1
                self.status = (
                    f"Site {interceptor.launcher_site_id} interceptor {interceptor.id} neutralized threat {threat.id}."
                )

    def _select_launcher_sites(
        self,
        target_pos: np.ndarray,
        target_vel: np.ndarray,
    ) -> list[tuple[int, str, Interceptor, float]]:
        target_speed = float(np.linalg.norm(target_vel))
        target_altitude = float(target_pos[1])
        nearest_site_distance = min(
            float(
                np.linalg.norm(
                    target_pos - vec(site.position.x, site.position.y)
                )
            )
            for site in self.config.interceptor_sites
        )

        if target_speed >= self.config.hypersonic_threat_speed_threshold:
            doctrine_order = ["hypersonic", "medium", "short"]
        elif (
            target_altitude <= self.config.short_range_interceptor_max_altitude
            and nearest_site_distance <= self.config.short_range_interceptor_max_range
        ):
            doctrine_order = ["short", "medium", "hypersonic"]
        else:
            doctrine_order = ["medium", "hypersonic", "short"]

        allow_salvo = target_speed >= self.config.hypersonic_threat_speed_threshold
        selections: list[tuple[int, str, Interceptor, float]] = []
        for interceptor_class in doctrine_order:
            best_choice: tuple[int, str, Interceptor, float] | None = None
            profile = self._interceptor_profile(interceptor_class)
            for site in self.config.interceptor_sites:
                if not self._site_available(site.id):
                    continue
                if interceptor_class not in site.supported_layers:
                    continue
                site_pos = vec(site.position.x, site.position.y)
                if not self._within_engagement_envelope(
                    site_pos,
                    target_pos,
                    interceptor_class,
                ):
                    continue
                interceptor_body = Interceptor(
                    pos=site_pos,
                    speed=profile["speed"],
                    max_turn_accel=profile["turn_accel"],
                )
                intercept_time = solve_intercept_time(
                    interceptor_body.pos,
                    interceptor_body.speed,
                    target_pos,
                    target_vel,
                )
                if intercept_time is None:
                    continue
                if best_choice is None or intercept_time < best_choice[3]:
                    best_choice = (
                        site.id,
                        interceptor_class,
                        interceptor_body,
                        intercept_time,
                    )
            if best_choice is not None:
                selections.append(best_choice)
                if not allow_salvo:
                    break
                # For salvo, try to find second distinct site of same class
                for site in self.config.interceptor_sites:
                    if site.id == best_choice[0]:
                        continue
                    if not self._site_available(site.id):
                        continue
                    if interceptor_class not in site.supported_layers:
                        continue
                    site_pos = vec(site.position.x, site.position.y)
                    if not self._within_engagement_envelope(
                        site_pos,
                        target_pos,
                        interceptor_class,
                    ):
                        continue
                    interceptor_body = Interceptor(
                        pos=site_pos,
                        speed=profile["speed"],
                        max_turn_accel=profile["turn_accel"],
                    )
                    intercept_time = solve_intercept_time(
                        interceptor_body.pos,
                        interceptor_body.speed,
                        target_pos,
                        target_vel,
                    )
                    if intercept_time is None:
                        continue
                    selections.append(
                        (
                            site.id,
                            interceptor_class,
                            interceptor_body,
                            intercept_time,
                        )
                    )
                if selections:
                    return sorted(selections, key=lambda item: item[3])[:2 if allow_salvo else 1]

        return selections

    def _interceptor_profile(self, interceptor_class: str) -> dict[str, float]:
        if interceptor_class == "short":
            return {
                "speed": self.config.short_range_interceptor_speed,
                "turn_accel": self.config.short_range_interceptor_turn_accel,
                "max_range": self.config.short_range_interceptor_max_range,
                "max_altitude": self.config.short_range_interceptor_max_altitude,
            }
        if interceptor_class == "medium":
            return {
                "speed": self.config.medium_range_interceptor_speed,
                "turn_accel": self.config.medium_range_interceptor_turn_accel,
                "max_range": self.config.medium_range_interceptor_max_range,
                "max_altitude": self.config.medium_range_interceptor_max_altitude,
            }
        return {
            "speed": self.config.hypersonic_interceptor_speed,
            "turn_accel": self.config.hypersonic_interceptor_turn_accel,
            "max_range": self.config.hypersonic_interceptor_max_range,
            "max_altitude": self.config.hypersonic_interceptor_max_altitude,
        }

    def _within_engagement_envelope(
        self,
        site_pos: np.ndarray,
        target_pos: np.ndarray,
        interceptor_class: str,
    ) -> bool:
        profile = self._interceptor_profile(interceptor_class)
        range_to_target = float(np.linalg.norm(target_pos - site_pos))
        return (
            range_to_target <= profile["max_range"]
            and float(target_pos[1]) <= profile["max_altitude"]
        )

    def _site_available(self, site_id: int) -> bool:
        if (
            self.time - self.site_last_launch_time.get(site_id, -1e9)
            < self.config.site_cooldown_seconds
        ):
            return False

        active_from_site = sum(
            1
            for interceptor in self.interceptors
            if interceptor.body.active and interceptor.launcher_site_id == site_id
        )
        return active_from_site < self.config.max_active_interceptors_per_site

    def _solve_targeted_launch_angle(
        self,
        speed: float,
        target_pos: np.ndarray,
    ) -> float | None:
        launch_pos = vec(self.config.target_start.x, self.config.target_start.y)
        dx = target_pos[0] - launch_pos[0]
        dy = target_pos[1] - launch_pos[1]
        if dx <= 0:
            return None
        gravity = abs(self.config.gravity.y)
        speed_sq = max(speed**2, 1e-6)
        discriminant = speed_sq**2 - gravity * (
            gravity * dx**2 + 2.0 * dy * speed_sq
        )
        if discriminant < 0.0:
            return None

        sqrt_term = np.sqrt(discriminant)
        denominator = gravity * dx
        if abs(denominator) < 1e-6:
            return None

        low_arc_radians = np.arctan((speed_sq - sqrt_term) / denominator)
        return float(np.degrees(low_arc_radians))

    def _resolve_target_impact(self, threat: ThreatRecord) -> None:
        if threat.intended_target_id is not None:
            target = self._find_defended_target(threat.intended_target_id)
            if target is not None and not target.destroyed:
                if np.linalg.norm(threat.body.pos - target.position) <= 10.0:
                    target.destroyed = True
                    self.destroyed_target_count += 1
                    self.status = (
                        f"Threat {threat.id} destroyed target {target.id} ({target.name})."
                    )
                    return
        self.status = f"Threat {threat.id} impacted before intercept."

    def _update_phase(self) -> None:
        active_threats = [item for item in self.threats if item.body.active]
        active_tracks = [
            item
            for item in self.radar_tracks.values()
            if item.detected and (self._find_threat(item.threat_id) or False)
        ]
        active_interceptors = [item for item in self.interceptors if item.body.active]

        if not self.threats:
            self.phase = "idle"
            return
        if self.destroyed_target_count:
            self.phase = "failure"
            return
        if active_threats and active_interceptors:
            self.phase = "engaging"
            return
        if active_threats and any(track.track_locked for track in active_tracks):
            self.phase = "tracking"
            return
        if active_threats:
            self.phase = "search"
            return
        if self.intercepted_count and self.impacted_count == 0:
            self.phase = "success"
            return
        self.phase = "failure"

    def snapshot(self) -> SimulationState:
        active_threat_count = sum(1 for item in self.threats if item.body.active)
        active_interceptor_count = sum(1 for item in self.interceptors if item.body.active)
        predicted_intercepts = [
            self._to_vector(item.predicted_intercept)
            for item in self.interceptors
            if item.body.active and item.predicted_intercept is not None
        ]

        return SimulationState(
            time=self.time,
            status=self.status,
            phase=self.phase,
            threats=[self._body_state(item) for item in self.threats],
            interceptors=[self._interceptor_state(item) for item in self.interceptors],
            radar_tracks=[self._track_state(item) for item in self.radar_tracks.values()],
            predicted_intercepts=[
                item for item in predicted_intercepts if item is not None
            ],
            targets=[self._target_state(item) for item in self.targets],
            active_threat_count=active_threat_count,
            active_interceptor_count=active_interceptor_count,
            intercepted_count=self.intercepted_count,
            impacted_count=self.impacted_count,
            destroyed_target_count=self.destroyed_target_count,
            config=self.config,
        )

    def _body_state(self, threat: ThreatRecord) -> BodyState:
        trail = [self._to_vector(point) for point in threat.body.trail[-200:] if point is not None]
        return BodyState(
            id=threat.id,
            active=threat.body.active,
            destroyed=threat.destroyed,
            assigned_target_id=None,
            launcher_site_id=None,
            interceptor_class=None,
            intended_target_id=threat.intended_target_id,
            position=self._to_vector(threat.body.pos),
            velocity=self._to_vector(threat.body.vel),
            trail=trail,
        )

    def _interceptor_state(self, interceptor: InterceptorRecord) -> BodyState:
        trail = [
            self._to_vector(point)
            for point in interceptor.body.trail[-200:]
            if point is not None
        ]
        return BodyState(
            id=interceptor.id,
            active=interceptor.body.active,
            destroyed=interceptor.destroyed_target,
            assigned_target_id=interceptor.target_id,
            launcher_site_id=interceptor.launcher_site_id,
            interceptor_class=interceptor.interceptor_class,
            intended_target_id=None,
            position=self._to_vector(interceptor.body.pos),
            velocity=self._to_vector(interceptor.body.vel),
            trail=trail,
        )

    def _target_state(self, target: DefendedTargetRecord) -> TargetState:
        return TargetState(
            id=target.id,
            name=target.name,
            position=self._to_vector(target.position) or Vector2(x=0.0, y=0.0),
            velocity=self._to_vector(target.velocity) or Vector2(x=0.0, y=0.0),
            destroyed=target.destroyed,
        )

    def _track_state(self, track: RadarTrackRecord) -> TrackEstimate:
        return TrackEstimate(
            threat_id=track.threat_id,
            detected=track.detected,
            track_locked=track.track_locked,
            position=self._to_vector(track.estimated_pos),
            velocity=self._to_vector(track.estimated_vel),
            last_detection_time=track.last_detection_time,
        )

    def _find_threat(self, threat_id: int) -> ThreatRecord | None:
        for threat in self.threats:
            if threat.id == threat_id:
                return threat
        return None

    def _find_defended_target(self, target_id: int) -> DefendedTargetRecord | None:
        for target in self.targets:
            if target.id == target_id:
                return target
        return None

    @staticmethod
    def _closest_point_on_segment(
        start: np.ndarray,
        end: np.ndarray,
        point: np.ndarray,
    ) -> np.ndarray:
        segment = end - start
        segment_len_sq = float(np.dot(segment, segment))
        if segment_len_sq <= 1e-9:
            return start
        projection = float(np.dot(point - start, segment)) / segment_len_sq
        projection = max(0.0, min(1.0, projection))
        return start + segment * projection

    @staticmethod
    def _to_vector(value: np.ndarray | None) -> Vector2 | None:
        if value is None:
            return None
        return Vector2(x=float(value[0]), y=float(value[1]))
