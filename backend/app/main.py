from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models import LaunchRequest, SimulationConfig, SimulationState
from .sim_engine import SimulationEngine


app = FastAPI(title="Air Defense Simulation API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = SimulationEngine(config=SimulationConfig())


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/state", response_model=SimulationState)
def get_state() -> SimulationState:
    return engine.snapshot()


@app.post("/scenario/launch", response_model=SimulationState)
def launch_threat(request: LaunchRequest) -> SimulationState:
    engine.launch_threat(
        speed=request.speed,
        angle_deg=request.angle_deg,
        target_id=request.target_id,
    )
    return engine.snapshot()


@app.post("/scenario/strike-all", response_model=SimulationState)
def strike_all_targets() -> SimulationState:
    engine.launch_dual_target_strike()
    return engine.snapshot()

@app.post("/simulation/step", response_model=SimulationState)
def step_simulation(steps: int = 1) -> SimulationState:
    return engine.step(steps=steps)


@app.post("/simulation/reset", response_model=SimulationState)
def reset_simulation() -> SimulationState:
    engine.reset()
    return engine.snapshot()
