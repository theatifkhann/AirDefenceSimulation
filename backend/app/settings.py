from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from os import getenv
from pathlib import Path


def _parse_bool(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_origins(value: str | None) -> list[str]:
    if not value:
        return []
    return [origin.strip() for origin in value.split(",") if origin.strip()]


@dataclass(frozen=True)
class Settings:
    app_env: str
    cors_allowed_origins: list[str]
    serve_frontend: bool
    frontend_dist: Path


@lru_cache
def get_settings() -> Settings:
    app_env = getenv("AIR_DEF_APP_ENV", "development").strip().lower() or "development"
    repo_root = Path(__file__).resolve().parents[2]
    frontend_dist = Path(
        getenv("AIR_DEF_FRONTEND_DIST", str(repo_root / "frontend" / "dist"))
    ).expanduser()
    default_origins = (
        ["http://127.0.0.1:5173", "http://localhost:5173"] if app_env == "development" else []
    )

    return Settings(
        app_env=app_env,
        cors_allowed_origins=_parse_origins(getenv("AIR_DEF_ALLOWED_ORIGINS")) or default_origins,
        serve_frontend=_parse_bool(getenv("AIR_DEF_SERVE_FRONTEND"), default=app_env != "development"),
        frontend_dist=frontend_dist,
    )
