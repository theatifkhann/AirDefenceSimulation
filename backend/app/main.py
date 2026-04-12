from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from .models import LaunchRequest, SimulationConfig, SimulationState
from .sim_engine import SimulationEngine
from .settings import get_settings


app = FastAPI(title="Air Defense Simulation API", version="0.1.0")
settings = get_settings()

if settings.cors_allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.state.engine = SimulationEngine(config=SimulationConfig())


def _resolve_static_file(frontend_dist: Path, requested_path: str) -> Path | None:
    candidate = (frontend_dist / requested_path).resolve()
    if candidate.is_file() and candidate.is_relative_to(frontend_dist.resolve()):
        return candidate
    return None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/state", response_model=SimulationState)
def get_state() -> SimulationState:
    return app.state.engine.snapshot()


@app.post("/scenario/launch", response_model=SimulationState)
def launch_threat(request: LaunchRequest) -> SimulationState:
    app.state.engine.launch_threat(
        speed=request.speed,
        angle_deg=request.angle_deg,
        target_id=request.target_id,
    )
    return app.state.engine.snapshot()


@app.post("/scenario/strike-all", response_model=SimulationState)
def strike_all_targets() -> SimulationState:
    app.state.engine.launch_dual_target_strike()
    return app.state.engine.snapshot()


@app.post("/simulation/step", response_model=SimulationState)
def step_simulation(steps: int = 1) -> SimulationState:
    return app.state.engine.step(steps=steps)


@app.post("/simulation/reset", response_model=SimulationState)
def reset_simulation() -> SimulationState:
    app.state.engine.reset()
    return app.state.engine.snapshot()


if settings.serve_frontend:

    @app.get("/", include_in_schema=False)
    def serve_index() -> FileResponse:
        return FileResponse(settings.frontend_dist / "index.html")


    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str) -> FileResponse:
        if static_file := _resolve_static_file(settings.frontend_dist, full_path):
            return FileResponse(static_file)
        return FileResponse(settings.frontend_dist / "index.html")
