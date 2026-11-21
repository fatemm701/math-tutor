import sqlite3
import time
from typing import Literal

from fastapi import APIRouter, Cookie, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth import (
    COOKIE_NAME,
    create_session,
    delete_session,
    generate_invite_code,
    get_current_user,
    hash_password,
    login_limiter,
    verify_password,
)
from app.config import settings
from app.db import get_conn

router = APIRouter(prefix="/api/auth", tags=["auth"])


def ok(data=None) -> dict:
    return {"success": True, "data": data}


def fail(msg: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse({"success": False, "msg": msg}, status_code=status_code)


class RegisterReq(BaseModel):
    name: str
    password: str
    role: Literal["teacher", "student"] = "student"
    inviteCode: str = ""
    teacherInvite: str = ""


class LoginReq(BaseModel):
    name: str
    password: str


def _set_session_cookie(resp: Response, sid: str) -> None:
    resp.set_cookie(
        key=COOKIE_NAME,
        value=sid,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=settings.session_ttl_seconds,
        path="/",
    )


@router.post("/register")
def register(body: RegisterReq, response: Response):
    name = body.name.strip()
    if not (2 <= len(name) <= 20):
        return fail("用户名长度需在 2~20 个字符之间")
    if len(body.password) < 4:
        return fail("密码至少 4 位")

    invite_code = None
    teacher_id = None

    with get_conn() as conn:
        if body.role == "teacher":
            if not settings.teacher_invite:
                return fail("服务端未开启教师注册", status_code=403)
            if body.teacherInvite.strip() != settings.teacher_invite:
                return fail("管理员口令不正确", status_code=403)
            # 生成唯一 6 位邀请码
            for _ in range(10):
                cand = generate_invite_code()
                if not conn.execute(
                    "SELECT 1 FROM users WHERE invite_code = ?", (cand,)
                ).fetchone():
                    invite_code = cand
                    break
        else:
            code = body.inviteCode.strip().upper()
            if code:
                teacher = conn.execute(
                    "SELECT id FROM users WHERE role = 'teacher' AND invite_code = ?",
                    (code,),
                ).fetchone()
                if not teacher:
                    return fail("邀请码无效，请向老师核对")
                teacher_id = teacher["id"]

        pw_hash = hash_password(body.password)
        now = int(time.time())
        try:
            cur = conn.execute(
                """
                INSERT INTO users (name, password_hash, role, invite_code, teacher_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (name, pw_hash, body.role, invite_code, teacher_id, now),
            )
        except sqlite3.IntegrityError:
            return fail("该用户名已被注册", status_code=409)

        user_id = cur.lastrowid

    sid = create_session(user_id)
    _set_session_cookie(response, sid)
    return ok({
        "id": user_id,
        "name": name,
        "role": body.role,
        "inviteCode": invite_code,
    })


@router.post("/login")
def login(body: LoginReq, request: Request, response: Response):
    client_ip = request.client.host if request.client else "unknown"
    if login_limiter.is_blocked(client_ip):
        return fail("登录失败次数过多，请 5 分钟后再试", status_code=429)

    name = body.name.strip()
    with get_conn() as conn:
        user = conn.execute(
            "SELECT id, name, password_hash, role, invite_code FROM users WHERE name = ?",
            (name,),
        ).fetchone()

    if not user or not verify_password(body.password, user["password_hash"]):
        login_limiter.record_failure(client_ip)
        return fail("用户名或密码错误", status_code=401)

    login_limiter.reset(client_ip)
    sid = create_session(user["id"])
    _set_session_cookie(response, sid)
    return ok({
        "id": user["id"],
        "name": user["name"],
        "role": user["role"],
        "inviteCode": user["invite_code"],
    })


@router.post("/logout")
def logout(response: Response, pd_sid: str | None = Cookie(default=None)):
    if pd_sid:
        delete_session(pd_sid)
    response.delete_cookie(COOKIE_NAME, path="/")
    return ok()


@router.get("/me")
def me(user=Depends(get_current_user)):
    if not user:
        return fail("未登录", status_code=401)
    return ok({
        "id": user["id"],
        "name": user["name"],
        "role": user["role"],
        "inviteCode": user["invite_code"],
    })