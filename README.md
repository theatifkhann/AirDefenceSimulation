# Air Defense Simulation

Interactive air-defense demo: a **FastAPI** backend runs a lightweight interceptor/threat simulation, and a **React + Three.js** frontend shows a tactical 3D view with controls and telemetry.

## Features

- 3D tactical scene (models, terrain, effects) built with **React Three Fiber**
- REST API for simulation state, stepping, resets, and scripted launches
- Operator UI: control panel, telemetry, and results

## Stack

| Layer    | Technologies                                      |
| -------- | ------------------------------------------------- |
| Frontend | React 19, TypeScript, Vite 6, Three.js, R3F, Drei |
| Backend  | Python 3.11+, FastAPI, Uvicorn, NumPy, Pydantic   |

## Prerequisites

- **Node.js** 20+ (for Vite 6)
- **Python** 3.11+

## Repository layout

```
air-def/
├── frontend/          # Vite SPA — UI and 3D scene
├── backend/           # FastAPI app and simulation engine (`app/`)
└── README.md
```

## Run locally

Start the **backend** first (default `http://127.0.0.1:8000`), then the **frontend** (`http://127.0.0.1:5173`).

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

If editable install fails, install dependencies directly:

```bash
pip install "fastapi>=0.115" "numpy>=2.1" "pydantic>=2.9" "uvicorn>=0.30"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Interactive docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

The dev client expects the API at `http://127.0.0.1:8000` (see `frontend/src/api/client.ts`). Change `API_BASE` there if your backend runs elsewhere.

### Production build (frontend only)

```bash
cd frontend
npm run build
npm run preview    # optional: test the static build locally
```

Serve the `frontend/dist` output behind any static host or CDN; point the app at your deployed API URL (via env/build-time config if you add one).

## HTTP API

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/health` | Liveness check |
| `GET` | `/state` | Current simulation snapshot |
| `POST` | `/scenario/launch` | Launch a threat (JSON body: speed, angle, optional target) |
| `POST` | `/scenario/strike-all` | Trigger dual-target strike scenario |
| `POST` | `/simulation/step?steps=1` | Advance simulation by `steps` |
| `POST` | `/simulation/reset` | Reset simulation |

State is held **in memory** in a single server process; use one API instance for a consistent world.

## Development notes

- CORS is open (`*`) for local dev; tighten `allow_origins` for production.
- Large 3D/audio assets live under `frontend/public/`; clones may take a moment on slow links.

## License

Add a license file if you distribute this project publicly.
