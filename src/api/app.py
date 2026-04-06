"""
FastAPI application — Basketball Prediction Market Decision Terminal API.

All endpoints serve the React frontend. No business logic here —
delegates to existing backend modules.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import dashboard, decisions, games, signals, backtest, risk, monitoring

START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: could init DB pool, load model, etc.
    yield
    # Shutdown: cleanup


app = FastAPI(
    title="BPMDE Terminal API",
    description="Basketball Prediction Market Decision Engine — Terminal Backend",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount route modules
app.include_router(dashboard.router, prefix="/api", tags=["Dashboard"])
app.include_router(games.router, prefix="/api", tags=["Games"])
app.include_router(signals.router, prefix="/api", tags=["Signals"])
app.include_router(backtest.router, prefix="/api", tags=["Backtest"])
app.include_router(risk.router, prefix="/api", tags=["Risk"])
app.include_router(monitoring.router, prefix="/api", tags=["Monitoring"])
app.include_router(decisions.router, prefix="/api", tags=["Decisions"])


@app.get("/api/ping")
async def ping():
    return {"status": "ok", "uptime_s": round(time.time() - START_TIME, 1)}
