export type Vector2 = {
  x: number;
  y: number;
};

export type InterceptorSite = {
  id: number;
  position: Vector2;
  supported_layers: string[];
};

export type DefendedTarget = {
  id: number;
  name: string;
  position: Vector2;
  velocity: Vector2;
  destroyed: boolean;
};

export type BodyState = {
  id: number | null;
  active: boolean;
  destroyed: boolean;
  assigned_target_id: number | null;
  launcher_site_id: number | null;
  interceptor_class: string | null;
  intended_target_id: number | null;
  position: Vector2 | null;
  velocity: Vector2 | null;
  trail: Vector2[];
};

export type TrackEstimate = {
  threat_id: number;
  detected: boolean;
  track_locked: boolean;
  position: Vector2 | null;
  velocity: Vector2 | null;
  last_detection_time: number | null;
};

export type SimulationConfig = {
  dt: number;
  gravity: Vector2;
  target_start: Vector2;
  launch_sites: Vector2[];
  interceptor_sites: InterceptorSite[];
  defended_targets: DefendedTarget[];
  radar_pos: Vector2;
  radar_range: number;
  short_range_interceptor_speed: number;
  short_range_interceptor_turn_accel: number;
  short_range_interceptor_max_range: number;
  short_range_interceptor_max_altitude: number;
  medium_range_interceptor_speed: number;
  medium_range_interceptor_turn_accel: number;
  medium_range_interceptor_max_range: number;
  medium_range_interceptor_max_altitude: number;
  hypersonic_threat_speed_threshold: number;
  hypersonic_interceptor_speed: number;
  hypersonic_interceptor_turn_accel: number;
  hypersonic_interceptor_max_range: number;
  hypersonic_interceptor_max_altitude: number;
  intercept_radius: number;
};

export type SimulationState = {
  time: number;
  status: string;
  phase: "idle" | "search" | "tracking" | "engaging" | "success" | "failure";
  threats: BodyState[];
  interceptors: BodyState[];
  radar_tracks: TrackEstimate[];
  predicted_intercepts: Vector2[];
  targets: DefendedTarget[];
  active_threat_count: number;
  active_interceptor_count: number;
  intercepted_count: number;
  impacted_count: number;
  destroyed_target_count: number;
  config: SimulationConfig;
};
