# main.py (proxy) — session-aware SSE proxy for Vertex AI Agent Engine
import os
import json
from typing import Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

import google.auth
from google.auth.transport.requests import AuthorizedSession

# --------------------------------------------------------------------------------------
# Environment / config
# --------------------------------------------------------------------------------------
ENGINE_RESOURCE = os.environ.get("AGENT_ENGINE_RESOURCE")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
API_KEY = os.environ.get("PUBLIC_API_KEY")

if not ENGINE_RESOURCE or "/reasoningEngines/" not in ENGINE_RESOURCE:
    raise RuntimeError("AGENT_ENGINE_RESOURCE env var is required and must be a full resource path.")

parts = ENGINE_RESOURCE.split("/")
# projects/{pid}/locations/{loc}/reasoningEngines/{engine}
PROJECT_ID = parts[1]
LOCATION = parts[3]
ENGINE_ID = parts[5]

AIP_QUERY       = f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/reasoningEngines/{ENGINE_ID}:query"
AIP_STREAM_SSE  = f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/reasoningEngines/{ENGINE_ID}:streamQuery?alt=sse"

# --------------------------------------------------------------------------------------
# FastAPI setup
# --------------------------------------------------------------------------------------
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN] if ALLOWED_ORIGIN != "*" else ["*"],
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)

def authed_session() -> AuthorizedSession:
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
    creds, _ = google.auth.default(scopes=scopes)
    return AuthorizedSession(creds)

# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
def require_key(request: Request):
    if API_KEY and request.headers.get("x-api-key") != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

# --- create_session(): 
def create_session(user_id: str) -> str:
    session = authed_session()
    body = {
        "classMethod": "async_create_session", 
        "input": {"user_id": user_id},
    }
    resp = session.post(AIP_QUERY, json=body, timeout=30)

    raw_text = getattr(resp, "text", "") or ""
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=raw_text or "Upstream error")

    try:
        data = resp.json() or {}
    except Exception:
        raise HTTPException(status_code=500, detail=f"Invalid JSON from Agent Engine: {raw_text[:500]}")

    # New: prefer output.id (actual response shape), with fallbacks
    sid = (
        data.get("output", {}).get("id")
        or data.get("id")
        or (
            (lambda name: name.rsplit("/sessions/", 1)[-1].strip())
            (data.get("name")) if isinstance(data.get("name"), str) and "/sessions/" in data.get("name") else None
        )
    )

    if not sid:
        raise HTTPException(
            status_code=500,
            detail=f"No session id returned from Agent Engine. Payload: {raw_text[:1000]}"
        )
    return sid

# --------------------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------------------
@app.post("/session")
async def new_session(request: Request):
    """
    Create a new session for a user. Returns { user_id, session_id }.
    """
    require_key(request)
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    user_id = (payload or {}).get("user_id") or "luna"
    sid = create_session(user_id)
    return {"user_id": user_id, "session_id": sid}

@app.post("/chat/stream")
async def chat_stream(request: Request):
    """
    Stream a chat turn to Agent Engine bound to a specific session.
    Body: { message: str, user_id?: str, session_id?: str }
    """
    require_key(request)

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    message: Optional[str]    = (payload or {}).get("message")
    user_id: str              = (payload or {}).get("user_id") or "luna"
    session_id: Optional[str] = (payload or {}).get("session_id")

    if not isinstance(message, str) or not message.strip():
        raise HTTPException(status_code=400, detail="Missing 'message'")

    # If client didn't provide a session, you can either:
    #  (a) create a new one implicitly (below), or
    #  (b) reject and require the client to call /session first.
    if not session_id:
        # Option (a): create implicitly so first turn works out of the box.
        session_id = create_session(user_id)

    # --- /chat/stream: use classMethod and pass the session every turn
    body = {
        "classMethod": "async_stream_query",  # ← was class_method
        "input": {
            "user_id": user_id,
            "session_id": session_id,  # keep this constant to reuse the same session
            "message": message,
        },
    }

    session = authed_session()
    upstream = session.post(
        AIP_STREAM_SSE,
        json=body,
        headers={"Accept": "text/event-stream"},
        stream=True,
        timeout=120,
    )

    if upstream.status_code >= 400:
        text = upstream.text if hasattr(upstream, "text") else ""
        raise HTTPException(status_code=upstream.status_code, detail=text or "Upstream error")

    def gen():
        # Send a small prelude so the client learns the session id on first turn
        prelude = json.dumps({"type": "session", "session_id": session_id}).encode("utf-8")
        yield b"data: " + prelude + b"\n\n"
        try:
            for line in upstream.iter_lines():
                if line is None:
                    continue
                if line == b"":  # SSE heartbeat / separator
                    yield b"\n"
                    continue
                # Pass through, normalizing to "data: " prefix
                if line.startswith(b"data:"):
                    yield line + b"\n"
                else:
                    yield b"data: " + line + b"\n"
            yield b"data: [DONE]\n\n"
        finally:
            upstream.close()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        },
    )