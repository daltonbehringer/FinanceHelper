from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.db import execute, fetchone

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    min_checking: Optional[float] = None


@router.get("")
async def get_settings(user_id: int = Depends(get_current_user)):
    row = fetchone("SELECT * FROM user_settings WHERE user_id = ?", (user_id,))
    if not row:
        return {"min_checking": 0}
    return dict(row)


@router.put("")
async def update_settings(body: SettingsUpdate, user_id: int = Depends(get_current_user)):
    now = datetime.utcnow().isoformat()
    existing = fetchone("SELECT id FROM user_settings WHERE user_id = ?", (user_id,))
    if existing:
        if body.min_checking is not None:
            execute(
                "UPDATE user_settings SET min_checking = ?, updated_at = ? WHERE user_id = ?",
                (body.min_checking, now, user_id),
            )
    else:
        execute(
            "INSERT INTO user_settings (user_id, min_checking, updated_at) VALUES (?, ?, ?)",
            (user_id, body.min_checking or 0, now),
        )
    row = fetchone("SELECT * FROM user_settings WHERE user_id = ?", (user_id,))
    return dict(row)
