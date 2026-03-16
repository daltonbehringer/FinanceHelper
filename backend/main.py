from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

from backend.auth import router as auth_router
from backend.db import init_db
from backend.routers.accounts import router as accounts_router
from backend.routers.ai import router as ai_router
from backend.routers.expenses import router as expenses_router
from backend.routers.income import router as income_router
from backend.routers.snapshots import router as snapshots_router

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(snapshots_router)
app.include_router(ai_router)
app.include_router(expenses_router)
app.include_router(income_router)

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if not FRONTEND_DIST.exists():
        return {"detail": "Frontend not built. Run 'npm run build' in /frontend."}
    file_path = FRONTEND_DIST / full_path
    if full_path and file_path.is_file():
        return FileResponse(str(file_path))
    return FileResponse(str(FRONTEND_DIST / "index.html"))
