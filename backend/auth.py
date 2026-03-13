import os
from datetime import datetime

import stytch
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from stytch.core.response_base import StytchError

from backend.db import execute, fetchone

router = APIRouter(prefix="/auth", tags=["auth"])

stytch_client = stytch.Client(
    project_id=os.getenv("STYTCH_PROJECT_ID", ""),
    secret=os.getenv("STYTCH_SECRET", ""),
)


async def get_current_user(request: Request) -> int:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    token = auth_header[7:]
    try:
        resp = stytch_client.sessions.authenticate(session_token=token)
    except StytchError:
        raise HTTPException(status_code=401, detail="Invalid session")

    stytch_user_id = resp.user.user_id
    email = resp.user.emails[0].email if resp.user.emails else ""

    row = fetchone("SELECT id FROM users WHERE stytch_user_id = ?", (stytch_user_id,))
    if row:
        return row["id"]

    execute(
        "INSERT INTO users (stytch_user_id, email, created_at) VALUES (?, ?, ?)",
        (stytch_user_id, email, datetime.utcnow().isoformat()),
    )
    row = fetchone("SELECT id FROM users WHERE stytch_user_id = ?", (stytch_user_id,))
    return row["id"]


@router.get("/login")
async def login():
    public_token = os.getenv("STYTCH_PUBLIC_TOKEN", "")
    project_id = os.getenv("STYTCH_PROJECT_ID", "")
    api_base = "https://test.stytch.com" if "test" in project_id else "https://api.stytch.com"
    redirect_url = "http://localhost:8000/auth/callback"
    login_url = (
        f"{api_base}/v1/public/oauth/google/start"
        f"?public_token={public_token}"
        f"&login_redirect_url={redirect_url}"
        f"&signup_redirect_url={redirect_url}"
    )
    return RedirectResponse(url=login_url)


@router.get("/callback")
async def callback(token: str):
    try:
        resp = stytch_client.oauth.authenticate(
            token=token, session_duration_minutes=60
        )
    except StytchError:
        raise HTTPException(status_code=401, detail="OAuth authentication failed")

    session_token = resp.session_token
    response = RedirectResponse(url="/")
    response.set_cookie(
        key="stytch_session",
        value=session_token,
        samesite="lax",
        httponly=False,
        max_age=3600,
    )
    return response


@router.post("/logout")
async def logout(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            stytch_client.sessions.revoke(session_token=token)
        except StytchError:
            pass

    response = RedirectResponse(url="/", status_code=200)
    response.delete_cookie("stytch_session")
    return response


@router.get("/me")
async def me(user_id: int = Depends(get_current_user)):
    row = fetchone("SELECT email FROM users WHERE id = ?", (user_id,))
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"email": row["email"]}
