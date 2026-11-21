from collections import OrderedDict
import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.auth import require_user
from app.db import get_conn
from app.engines import equation, simplify, arithmetic
from app.engines.types import Question

router = APIRouter(prefix="/api/drill", tags=["drill"])

# 后续阶段只需在这里注册 equation / arithmetic
ENGINES = {
    "simplify": simplify,
    "equation": equation,
    "arithmetic": arithmetic,
}

MAX_CACHE_SIZE = 2000
_question_cache: OrderedDict[str, tuple[int, Question]] = OrderedDict()


def _cache_put(user_id: int, q: Question) -> str:
    token = secrets.token_hex(16)
    _question_cache[token] = (user_id, q)
    _question_cache.move_to_end(token)
    while len(_question_cache) > MAX_CACHE_SIZE:
        _question_cache.popitem(last=False)
    return token


def _cache_get(token: str, user_id: int) -> Question:
    item = _question_cache.get(token)
    if not item or item[0] != user_id:
        raise HTTPException(status_code=404, detail="题目已过期，请点击「下一题」")
    return item[1]


def _save_attempt(
    *,
    client_id: str,
    user_id: int,
    q: Question,
    student_answer: str,
    result: str,
    used_hint: bool,
    revealed: bool,
    gave_up: bool,
    ms: int,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO attempts (
                client_id, user_id, topic, level, question, answer,
                student_answer, result, used_hint, revealed, gave_up,
                is_fraction, is_decimal, ms, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                client_id,
                user_id,
                q.topic,
                q.level,
                q.prompt_raw,
                q.answer_raw,
                student_answer,
                result,
                1 if used_hint else 0,
                1 if revealed else 0,
                1 if gave_up else 0,
                1 if q.is_fraction else 0,
                1 if q.is_decimal else 0,
                max(0, ms),
                int(time.time()),
            ),
        )


def _steps_payload(q: Question) -> list[dict[str, str]]:
    return [
        {"title": s.title, "tex": s.tex, "note": s.note, "noteTex": s.note_tex}
        for s in q.steps
    ]


@router.get("/{topic}/next")
def next_question(
    topic: str,
    level: int = Query(default=1, ge=1, le=4),
    user: dict[str, Any] = Depends(require_user),
):
    engine = ENGINES.get(topic)
    if not engine:
        raise HTTPException(status_code=404, detail="未知练习类型")
    q = engine.generate(level)
    token = _cache_put(user["id"], q)
    return {
        "success": True,
        "data": {
            "token": token,
            "topic": q.topic,
            "level": q.level,
            "promptRaw": q.prompt_raw,
            "promptTex": q.prompt_tex,
            "isFraction": q.is_fraction,
            "isDecimal": q.is_decimal,
            "hint": q.hint,
        },
    }


class SubmitReq(BaseModel):
    token: str
    clientId: str
    studentAnswer: str
    usedHint: bool = False
    attemptNum: int = 1
    ms: int = 0


@router.post("/{topic}/submit")
def submit_answer(
    topic: str,
    body: SubmitReq,
    user: dict[str, Any] = Depends(require_user),
):
    engine = ENGINES.get(topic)
    if not engine:
        raise HTTPException(status_code=404, detail="未知练习类型")
    q = _cache_get(body.token, user["id"])
    res = engine.grade(q, body.studentAnswer)

    # 格式错不计入答错次数，允许继续修改
    is_format_error = res.result == "error"
    should_lock = res.is_correct or (not is_format_error and body.attemptNum >= 2)
    revealed = should_lock

    if should_lock:
        _save_attempt(
            client_id=body.clientId,
            user_id=user["id"],
            q=q,
            student_answer=body.studentAnswer.strip(),
            result=res.result,
            used_hint=body.usedHint,
            revealed=revealed,
            gave_up=False,
            ms=body.ms,
        )

    payload: dict[str, Any] = {
        "result": res.result,
        "isCorrect": res.is_correct,
        "feedback": res.feedback,
        "studentTex": res.student_tex,
        "locked": should_lock,
    }
    if revealed:
        payload["answerRaw"] = q.answer_raw
        payload["answerTex"] = q.answer_tex
        payload["steps"] = _steps_payload(q)
    return {"success": True, "data": payload}


class GiveUpReq(BaseModel):
    token: str
    clientId: str
    studentAnswer: str = ""
    usedHint: bool = False
    ms: int = 0


@router.post("/{topic}/giveup")
def give_up(
    topic: str,
    body: GiveUpReq,
    user: dict[str, Any] = Depends(require_user),
):
    if topic not in ENGINES:
        raise HTTPException(status_code=404, detail="未知练习类型")
    q = _cache_get(body.token, user["id"])
    _save_attempt(
        client_id=body.clientId,
        user_id=user["id"],
        q=q,
        student_answer=body.studentAnswer.strip(),
        result="wrong",
        used_hint=body.usedHint,
        revealed=True,
        gave_up=True,
        ms=body.ms,
    )
    return {
        "success": True,
        "data": {
            "locked": True,
            "answerRaw": q.answer_raw,
            "answerTex": q.answer_tex,
            "steps": _steps_payload(q),
        },
    }