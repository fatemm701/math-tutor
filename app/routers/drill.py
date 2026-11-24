from collections import OrderedDict
import json
import secrets
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app import scoring
from app.auth import require_user
from app.db import get_conn
from app.diagnosis import diagnosis_to_dict
from app.engines import equation, simplify, arithmetic
from app.engines.types import DiagnosisResult, Question

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
    corrected: bool = False,
    diagnosis_code: str | None = None,
    diagnosis_confidence: float | None = None,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO attempts (
                client_id, user_id, topic, level, question, answer,
                student_answer, result, used_hint, revealed, gave_up,
                is_fraction, is_decimal, ms, corrected,
                diagnosis_code, diagnosis_confidence, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                1 if corrected else 0,
                diagnosis_code,
                diagnosis_confidence,
                int(time.time()),
            ),
        )


def _get_first_attempt_diagnosis(
    client_id: str,
    user_id: int,
) -> tuple[str | None, float | None]:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT predicted_code, confidence
            FROM diagnosis_logs
            WHERE client_id = ? AND user_id = ? AND attempt_num = 1
            """,
            (client_id, user_id),
        ).fetchone()
    if not row:
        return None, None
    return str(row["predicted_code"]), float(row["confidence"])


def _save_diagnosis_log(
    *,
    client_id: str,
    attempt_num: int,
    user_id: int,
    q: Question,
    student_answer: str,
    diagnosis: DiagnosisResult,
) -> int:
    meta_json = json.dumps(q.meta, ensure_ascii=False)
    now = int(time.time())
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO diagnosis_logs (
                client_id, attempt_num, user_id, topic, level, question, answer,
                student_answer, meta_json, predicted_code, confidence, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                client_id,
                attempt_num,
                user_id,
                q.topic,
                q.level,
                q.prompt_raw,
                q.answer_raw,
                student_answer,
                meta_json,
                diagnosis.code,
                diagnosis.confidence,
                now,
            ),
        )
        row = conn.execute(
            "SELECT id FROM diagnosis_logs WHERE client_id = ? AND attempt_num = ?",
            (client_id, attempt_num),
        ).fetchone()
    return int(row["id"]) if row else 0


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
    with get_conn() as conn:
        priors = scoring.get_user_diagnosis_priors(conn, user["id"], topic=topic)
    res = engine.grade(q, body.studentAnswer, user_priors=priors)

    # 格式错不计入答错次数，允许继续修改
    is_format_error = res.result == "error"
    should_lock = res.is_correct or (not is_format_error and body.attemptNum >= 2)
    revealed = should_lock

    diag_log_id: int | None = None
    if res.diagnosis is not None:
        diag_log_id = _save_diagnosis_log(
            client_id=body.clientId,
            attempt_num=body.attemptNum,
            user_id=user["id"],
            q=q,
            student_answer=body.studentAnswer.strip(),
            diagnosis=res.diagnosis,
        )

    if should_lock:
        corrected = bool(res.is_correct and body.attemptNum >= 2)
        diag_code = res.diagnosis.code if res.diagnosis else None
        diag_conf = res.diagnosis.confidence if res.diagnosis else None
        if corrected and diag_code is None:
            diag_code, diag_conf = _get_first_attempt_diagnosis(body.clientId, user["id"])
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
            corrected=corrected,
            diagnosis_code=diag_code,
            diagnosis_confidence=diag_conf,
        )

    payload: dict[str, Any] = {
        "result": res.result,
        "isCorrect": res.is_correct,
        "feedback": res.feedback,
        "studentTex": res.student_tex,
        "locked": should_lock,
        "corrected": bool(res.is_correct and body.attemptNum >= 2),
    }
    if res.diagnosis is not None:
        payload["diagnosis"] = diagnosis_to_dict(
            res.diagnosis,
            log_id=diag_log_id,
            allow_spoiler=should_lock,
        )
    if revealed:
        payload["answerRaw"] = q.answer_raw
        payload["answerTex"] = q.answer_tex
        payload["steps"] = _steps_payload(q)
    return {"success": True, "data": payload}


class DiagnosisFeedbackReq(BaseModel):
    logId: int
    helpful: bool


@router.post("/diagnosis/feedback")
def submit_diagnosis_feedback(
    body: DiagnosisFeedbackReq,
    user: dict[str, Any] = Depends(require_user),
):
    fb_val = 1 if body.helpful else -1
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE diagnosis_logs SET feedback = ? WHERE id = ? AND user_id = ?",
            (fb_val, body.logId, user["id"]),
        )
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="未找到对应的诊断记录")
    return {"success": True, "data": {"logId": body.logId, "feedback": fb_val}}


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