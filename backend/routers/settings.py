from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, StrictInt

from backend.auth import get_current_user
from backend.db import fetchall, fetchone
from backend.services import settings as settings_service
from backend.services._core import EventContext

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    min_checking: Optional[StrictInt] = None  # integer cents; floats are rejected
    default_payment_account_id: Optional[int] = None
    advice_posture: Optional[str] = None


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
    if not result.get("payment_account_configured"):
        # User hasn't explicitly configured this setting — auto-detect single checking account
        checking = fetchall(
            "SELECT id FROM accounts WHERE user_id = ? AND type IN ('checking') AND is_active = 1",
            (user_id,),
        )
        if len(checking) == 1:
            result["default_payment_account_id"] = checking[0]["id"]
    # Strip internal flag from response
    result.pop("payment_account_configured", None)
    return result


@router.put("")
async def update_settings(body: SettingsUpdate, user_id: int = Depends(get_current_user)):
    settings_service.update_settings(
        user_id,
        min_checking=body.min_checking,
        default_payment_account_id=body.default_payment_account_id,
        advice_posture=body.advice_posture,
        ctx=EventContext(source="user"),
    )
    # Return the updated settings (reuse GET logic for auto-detect)
    return await get_settings(user_id)
