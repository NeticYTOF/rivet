"""Rivet's VEY sidecar: a tiny HTTP bridge between Rivet's TS decision client
(`lib/veyDecision.ts`) and `vey.decide()`.

Contract (the client fails closed on anything else):
  POST /decide
  {"version": 1, "question": str, "candidates": {label: consequence_text},
   "state": {..., "message": str, "conversationContext": str,
             "channelPosture": str, "addressed": bool}, "explain": true}
  ->
  200 {"answer": <one of the candidate labels>, "should_engage": bool,
       "should_engage_p": 0..1, "decision_mode": str, "certificate": {...}}

Two decisions per request, because vey.decide() answers ONE question per call:
1. intent  - pick among the 7 JEV intent candidates for the raw message.
2. engage  - pick between two candidates describing action vs silence.

No auth. Localhost only. No GPU - CRUX runs on CPU in single-digit ms.
"""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import vey

INTENT_LABELS = (
    "support_question",
    "direct_program_question",
    "addressed_general_request",
    "addressed_smalltalk",
    "ambiguous_followup",
    "unrelated_chatter",
    "human_conversation",
)

ENGAGE_YES = "rivet should look this up in the program docs and reply"
ENGAGE_NO = "rivet should stay silent and not reply"


def _read_json(handler: BaseHTTPRequestHandler) -> dict | None:
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        return None
    if length <= 0 or length > 256 * 1024:
        return None
    try:
        return json.loads(handler.rfile.read(length))
    except (ValueError, OSError):
        return None


def _send(handler: BaseHTTPRequestHandler, status: int, body: dict) -> None:
    raw = json.dumps(body).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def decide_intent(message: str, candidates: dict) -> tuple[str, str]:
    res = vey.decide(question=message, candidates=candidates, explain=True)
    label = str(getattr(res, "answer", ""))
    mode = str(getattr(res, "decision_mode", "unknown"))
    if label not in candidates:
        raise ValueError(f"vey returned undeclared label {label!r}")
    return label, mode


def decide_engage(message: str, conversation: str, addressed: bool, intent: str) -> tuple[bool, float]:
    context = " ".join(p for p in (conversation, message) if p).strip()
    res = vey.decide(
        question=context + f" | addressed_to_rivet={addressed} | tentative_intent={intent}",
        candidates={"engage": ENGAGE_YES, "no_engage": ENGAGE_NO},
        explain=True,
    )
    yes = str(getattr(res, "answer", "")) == "engage"
    return yes, 1.0 if yes else 0.0


class Handler(BaseHTTPRequestHandler):
    server_version = "rivet-vey/1"

    def log_message(self, *args):  # keep stdout for real errors
        pass

    def do_GET(self):
        if self.path.rstrip("/") in ("", "/health"):
            _send(self, 200, {"ok": True, "service": "rivet-vey", "version": 1})
        else:
            _send(self, 404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/decide":
            _send(self, 404, {"ok": False, "error": "not found"})
            return
        body = _read_json(self)
        if not body or not isinstance(body, dict):
            _send(self, 400, {"ok": False, "error": "bad body"})
            return
        if body.get("version") != 1:
            _send(self, 400, {"ok": False, "error": "unsupported version"})
            return
        candidates = body.get("candidates")
        state = body.get("state") or {}
        message = state.get("message") or ""
        if not isinstance(candidates, dict) or not candidates:
            _send(self, 400, {"ok": False, "error": "no candidates"})
            return
        if not isinstance(message, str) or not message.strip():
            _send(self, 400, {"ok": False, "error": "no message"})
            return
        if any(label not in INTENT_LABELS for label in candidates):
            _send(self, 400, {"ok": False, "error": "unknown intent labels"})
            return
        try:
            t0 = time.perf_counter()
            intent, mode = decide_intent(message, candidates)
            engage, engage_p = decide_engage(
                message,
                str(state.get("conversationContext") or ""),
                bool(state.get("addressed")),
                intent,
            )
            _send(
                self,
                200,
                {
                    "answer": intent,
                    "should_engage": engage,
                    "should_engage_p": engage_p,
                    "decision_mode": mode,
                    "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
                    "certificate": {},
                },
            )
        except Exception as e:  # fail loudly; the TS client fails closed
            _send(self, 500, {"ok": False, "error": f"decision failed: {e}"})


if __name__ == "__main__":
    import sys

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"rivet-vey listening on 127.0.0.1:{port}", flush=True)
    server.serve_forever()
