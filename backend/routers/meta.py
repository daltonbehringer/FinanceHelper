from fastapi import APIRouter, Depends

from backend.account_fields import registry_response
from backend.auth import get_current_user

router = APIRouter(prefix="/api/meta", tags=["meta"])


@router.get("/account-fields")
async def account_fields(user_id: int = Depends(get_current_user)):
    """Per-account-type field registry — the frontend renders account forms
    from this, and Phase 2 LLM tools will read the same contract."""
    return registry_response()
