import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

load_dotenv()

from backend.auth import router as auth_router
from backend.db import init_db
from backend.middleware import BodyGuardMiddleware, SecurityHeadersMiddleware
from backend.rate_limit import limiter
from backend.routers.accounts import router as accounts_router
from backend.routers.ai import router as ai_router
from backend.routers.budget import router as budget_router
from backend.routers.dashboard import router as dashboard_router
from backend.routers.events import router as events_router
from backend.routers.expenses import router as expenses_router
from backend.routers.history import router as history_router
from backend.routers.income import router as income_router
from backend.routers.meta import router as meta_router
from backend.routers.settings import router as settings_router
from backend.routers.snapshots import router as snapshots_router

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

# Rate limiting (per-session) for the AI endpoints — see backend/rate_limit.py.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Exact origins only (no wildcard) since we send credentialed cookies.
_cors_origins = [
    "https://finance.dalty.io",   # production frontend
    "http://localhost:3000",      # Vite dev server
    "http://localhost:8000",      # backend serving the built SPA
]
_frontend_url = os.getenv("FRONTEND_URL", "")
if _frontend_url and _frontend_url not in _cors_origins:
    _cors_origins.append(_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Hardening (Phase 4, WS2). Added last → outermost, so security headers land on
# every response (CORS preflights and rejections included) and the body cap runs
# before any handler. Pure-ASGI so the SSE chat stream is not buffered.
app.add_middleware(BodyGuardMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(snapshots_router)
app.include_router(ai_router)
app.include_router(expenses_router)
app.include_router(income_router)
app.include_router(meta_router)
app.include_router(settings_router)
app.include_router(events_router)
app.include_router(history_router)
app.include_router(dashboard_router)
app.include_router(budget_router)

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if not FRONTEND_DIST.exists():
        return {"detail": "Frontend not built. Run 'npm run build' in /frontend."}
    # Don't intercept API routes — let them 404 naturally
    if full_path.startswith("api/"):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    file_path = FRONTEND_DIST / full_path
    if full_path and file_path.is_file():
        return FileResponse(str(file_path))
    return FileResponse(str(FRONTEND_DIST / "index.html"))
