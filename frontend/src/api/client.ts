import type { SimulationState } from "../types";

const API_BASE = "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function getState(): Promise<SimulationState> {
  return request<SimulationState>("/state");
}

export function stepSimulation(steps = 1): Promise<SimulationState> {
  return request<SimulationState>(`/simulation/step?steps=${steps}`, {
    method: "POST",
  });
}

export function resetSimulation(): Promise<SimulationState> {
  return request<SimulationState>("/simulation/reset", {
    method: "POST",
  });
}

export function launchThreat(
  speed: number,
  angleDeg: number,
  targetId?: number,
): Promise<SimulationState> {
  return request<SimulationState>("/scenario/launch", {
    method: "POST",
    body: JSON.stringify({
      speed,
      angle_deg: angleDeg,
      target_id: targetId ?? null,
    }),
  });
}

export function strikeAllTargets(): Promise<SimulationState> {
  return request<SimulationState>("/scenario/strike-all", {
    method: "POST",
  });
}
