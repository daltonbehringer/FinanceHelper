import os
from datetime import datetime

import stytch
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from stytch.core.response_base import StytchError

from backend.db import execute, fetchone

router = APIRouter(prefix="/api/auth", tags=["auth"])

stytch_client = stytch.Client(
    project_id=os.getenv("STYTCH_PROJECT_ID", ""),
    secret=os.getenv("STYTCH_SECRET", ""),
)

SESSION_COOKIE = "stytch_session"
SESSION_DURATION_MINUTES = 60

# Cookie scoping. In production COOKIE_DOMAIN=.finance.dalty.io so the session
# is shared between finance.dalty.io (frontend) and api.finance.dalty.io (backend).
# Locally it is unset (host-only cookie via the Vite proxy on localhost).
COOKIE_DOMAIN = os.getenv("COOKIE_DOMAIN") or None
# Secure is required in production. localhost is treated as a secure context by
# modern browsers, so the default holds for local dev too; set COOKIE_SECURE=false
# if you serve the dev backend over plain http on a non-localhost host.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() != "false"


def _resolve_user(stytch_user_id: str, email: str) -> int:
    """Return the local user id for a Stytch user, creating it on first login."""
    row = fetchone("SELECT id FROM users WHERE stytch_user_id = ?", (stytch_user_id,))
    if row:
        return row["id"]
    execute(
        "INSERT INTO users (stytch_user_id, email, created_at) VALUES (?, ?, ?)",
        (stytch_user_id, email, datetime.utcnow().isoformat()),
    )
    return fetchone("SELECT id FROM users WHERE stytch_user_id = ?", (stytch_user_id,))["id"]


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_DURATION_MINUTES * 60,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        domain=COOKIE_DOMAIN,
        path="/",
    )


def _read_session_token(request: Request) -> str | None:
    """Cookie first; Authorization: Bearer kept only as a local-dev fallback."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        return token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


async def get_current_user(request: Request) -> int:
    token = _read_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing session")
    try:
        resp = stytch_client.sessions.authenticate(session_token=token)
    except StytchError:
        raise HTTPException(status_code=401, detail="Invalid session")

    stytch_user_id = resp.user.user_id
    email = resp.user.emails[0].email if resp.user.emails else ""
    return _resolve_user(stytch_user_id, email)


@router.get("/login")
async def login():
    public_token = os.getenv("STYTCH_PUBLIC_TOKEN", "")
    project_id = os.getenv("STYTCH_PROJECT_ID", "")
    backend_url = os.getenv("BACKEND_URL", "http://localhost:8000")
    api_base = "https://test.stytch.com" if "test" in project_id else "https://api.stytch.com"
    redirect_url = f"{backend_url}/api/auth/callback"
    login_url = (
        f"{api_base}/v1/public/oauth/google/start"
        f"?public_token={public_token}"
        f"&login_redirect_url={redirect_url}"
        f"&signup_redirect_url={redirect_url}"
    )
    return RedirectResponse(url=login_url)


@router.get("/callback")
async def callback(token: str):
    """Stytch OAuth lands here. Validate, set an HttpOnly session cookie, and
    redirect to the frontend. The session token never appears in any URL."""
    try:
        resp = stytch_client.oauth.authenticate(
            token=token, session_duration_minutes=SESSION_DURATION_MINUTES
        )
    except StytchError:
        raise HTTPException(status_code=401, detail="OAuth authentication failed")

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    response = RedirectResponse(url=frontend_url, status_code=302)
    _set_session_cookie(response, resp.session_token)
    return response


@router.post("/logout")
async def logout(request: Request):
    token = _read_session_token(request)
    if token:
        try:
            stytch_client.sessions.revoke(session_token=token)
        except StytchError:
            pass

    response = Response(status_code=200)
    # Clear with matching attributes so the browser actually drops it.
    response.delete_cookie(SESSION_COOKIE, domain=COOKIE_DOMAIN, path="/")
    return response


@router.get("/me")
async def me(user_id: int = Depends(get_current_user)):
    row = fetchone("SELECT email FROM users WHERE id = ?", (user_id,))
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"email": row["email"]}
