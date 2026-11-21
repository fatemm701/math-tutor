import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import Cookie, HTTPException

from app.config import settings
from app.db import get_conn

COOKIE_NAME = "pd_sid"
INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # 去掉易混淆的 0/O/1/I


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return f"scrypt:{salt.hex()}:{dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, dk_hex = stored.split(":")
        if scheme != "scrypt":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(dk_hex)
    except ValueError:
        return False
    actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return hmac.compare_digest(actual, expected)


def generate_invite_code(length: int = 6) -> str:
    return "".join(secrets.choice(INVITE_ALPHABET) for _ in range(length))


class LoginRateLimiter:
    """按 IP 做滑动窗口登录失败限速。"""

    def __init__(self, max_attempts: int = 10, window_seconds: int = 300) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, ip: str, now: float) -> deque[float]:
        q = self._hits[ip]
        cutoff = now - self.window_seconds
        while q and q[0] < cutoff:
            q.popleft()
        return q

    def is_blocked(self, ip: str) -> bool:
        return len(self._prune(ip, time.time())) >= self.max_attempts

    def record_failure(self, ip: str) -> None:
        now = time.time()
        q = self._prune(ip, now)
        q.append(now)

    def reset(self, ip: str) -> None:
        self._hits.pop(ip, None)


login_limiter = LoginRateLimiter()


def create_session(user_id: int) -> str:
    sid = secrets.token_hex(32)
    expires_at = int(time.time()) + settings.session_ttl_seconds
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (sid, user_id, expires_at) VALUES (?, ?, ?)",
            (sid, user_id, expires_at),
        )
    return sid


def delete_session(sid: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE sid = ?", (sid,))


def get_user_by_sid(sid: str | None) -> dict[str, Any] | None:
    if not sid:
        return None
    now = int(time.time())
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT u.id, u.name, u.role, u.invite_code, u.teacher_id
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.sid = ? AND s.expires_at > ?
            """,
            (sid, now),
        ).fetchone()
    return dict(row) if row else None


def get_current_user(pd_sid: str | None = Cookie(default=None)) -> dict[str, Any] | None:
    return get_user_by_sid(pd_sid)


def require_user(pd_sid: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = get_user_by_sid(pd_sid)
    if not user:
        raise HTTPException(status_code=401, detail="请先登录")
    return user


def require_teacher(pd_sid: str | None = Cookie(default=None)) -> dict[str, Any]:
    user = require_user(pd_sid)
    if user["role"] != "teacher":
        raise HTTPException(status_code=403, detail="仅教师账号可访问")
    return user