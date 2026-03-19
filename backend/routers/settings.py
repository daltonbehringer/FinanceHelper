from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.db import execute, fetchall, fetchone

router = APIRouter(prefix="/api/settings", tags=["settings"])

CHECKING_TYPES = {"checking"}


class SettingsUpdate(BaseModel):
    min_checking: Optional[float] = None
    default_payment_account_id: Optional[int] = None


@router.get("")
async def get_settings(user_id: int = Depends(get_current_user)):
    row = fetchone("SELECT * FROM user_settings WHERE user_id = ?", (user_id,))
    if not row:
        # No settings row yet — auto-detect single checking account
        checking = fetchall(
            "SELECT id FROM accounts WHERE user_id = ? AND type IN ('checking') AND is_active = 1",
            (user_id,),
        )
        default_id = checking[0]["id"] if len(checking) == 1 else None
        return {"min_checking": 0, "default_payment_account_id": default_id}

    result = dict(row)
    payment_id = result.get("default_payment_account_id")
    if payment_id is not None and payment_id < 0:
        # Sentinel value -1 means user explicitly chose "None"
        result["default_payment_account_id"] = None
    elif payment_id is None:
        # NULL means never configured — auto-detect single checking account
        checking = fetchall(
            "SELECT id FROM accounts WHERE user_id = ? AND type IN ('checking') AND is_active = 1",
            (user_id,),
        )
        if len(checking) == 1:
            result["default_payment_account_id"] = checking[0]["id"]
    return result


@router.put("")
async def update_settings(body: SettingsUpdate, user_id: int = Depends(get_current_user)):
    now = datetime.utcnow().isoformat()
    existing = fetchone("SELECT id FROM user_settings WHERE user_id = ?", (user_id,))
    if existing:
        updates = []
        params = []
        if body.min_checking is not None:
            updates.append("min_checking = ?")
            params.append(body.min_checking)
        if body.default_payment_account_id is not None:
            # 0 means "explicitly no default" — store as -1 sentinel to distinguish from NULL (never set)
            val = body.default_payment_account_id if body.default_payment_account_id > 0 else -1
            updates.append("default_payment_account_id = ?")
            params.append(val)
        if updates:
            updates.append("updated_at = ?")
            params.append(now)
            params.append(user_id)
            execute(
                f"UPDATE user_settings SET {', '.join(updates)} WHERE user_id = ?",
                tuple(params),
            )
    else:
        # -1 sentinel = explicitly no default; NULL = never configured (auto-detect)
        default_id = -1
        if body.default_payment_account_id and body.default_payment_account_id > 0:
            default_id = body.default_payment_account_id
        execute(
            "INSERT INTO user_settings (user_id, min_checking, default_payment_account_id, updated_at) VALUES (?, ?, ?, ?)",
            (user_id, body.min_checking or 0, default_id, now),
        )
    # Return the updated settings (reuse GET logic for auto-detect)
    return await get_settings(user_id)
