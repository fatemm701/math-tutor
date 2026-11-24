from __future__ import annotations

import sqlite3
import time
from typing import Any

from app.diagnosis.taxonomy import EQUATION_BUG_CODES, get_diagnosis_label


def get_user_diagnosis_priors(
    conn: sqlite3.Connection,
    user_id: int,
    topic: str = "equation",
    limit: int = 40,
) -> dict[str, float] | None:
    """
    基于该学生最近已诊断的错题记录计算平滑后的错因先验分布。
    样本数不足 5 条时返回 None（沿用模型默认分布）。
    """
    rows = conn.execute(
        """
        SELECT diagnosis_code
        FROM attempts
        WHERE user_id = ? AND topic = ? AND diagnosis_code IS NOT NULL AND diagnosis_code != ''
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        """,
        (user_id, topic, limit),
    ).fetchall()
    if len(rows) < 5:
        return None
    counts = {c: 1.0 for c in EQUATION_BUG_CODES}
    for r in rows:
        code = r["diagnosis_code"]
        if code in counts:
            counts[code] += 1.0
    total = sum(counts.values())
    return {c: v / total for c, v in counts.items()}


def _since_ts(days: int) -> int:
    if days <= 0:
        return 0
    return int(time.time()) - days * 86400


def get_user_summary(
    conn: sqlite3.Connection,
    user_id: int,
    days: int = 30,
    topic: str | None = None,
) -> dict[str, Any]:
    """返回单个用户的总览 KPI、按题型/难度分组统计、错因分布。"""
    since = _since_ts(days)
    where = ["user_id = ?", "result != 'error'", "created_at >= ?"]
    params: list[Any] = [user_id, since]
    if topic:
        where.append("topic = ?")
        params.append(topic)
    where_sql = " AND ".join(where)

    # 1. 总体 KPI
    row = conn.execute(
        f"""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END) AS correct,
            SUM(CASE WHEN result = 'correct' AND corrected = 0 THEN 1 ELSE 0 END) AS first_try_correct,
            SUM(CASE WHEN result = 'correct' AND corrected = 1 THEN 1 ELSE 0 END) AS corrected,
            SUM(CASE WHEN gave_up = 1 THEN 1 ELSE 0 END) AS gave_up,
            SUM(CASE WHEN used_hint = 1 THEN 1 ELSE 0 END) AS used_hint,
            ROUND(AVG(CASE WHEN ms > 0 THEN ms END), 0) AS avg_ms
        FROM attempts
        WHERE {where_sql}
        """,
        params,
    ).fetchone()

    total = row["total"] or 0
    correct = row["correct"] or 0
    first_try_correct = row["first_try_correct"] or 0
    corrected = row["corrected"] or 0
    accuracy = round(correct * 100.0 / total, 1) if total > 0 else 0.0
    first_try_accuracy = round(first_try_correct * 100.0 / total, 1) if total > 0 else 0.0

    # 2. 按题型 + 难度聚合
    by_topic_level = [
        dict(r)
        for r in conn.execute(
            f"""
            SELECT
                topic,
                level,
                COUNT(*) AS total,
                SUM(CASE WHEN result = 'correct' THEN 1 ELSE 0 END) AS correct,
                SUM(CASE WHEN gave_up = 1 THEN 1 ELSE 0 END) AS gave_up,
                ROUND(AVG(CASE WHEN ms > 0 THEN ms END), 0) AS avg_ms
            FROM attempts
            WHERE {where_sql}
            GROUP BY topic, level
            ORDER BY topic, level
            """,
            params,
        ).fetchall()
    ]
    for item in by_topic_level:
        t = item["total"] or 0
        c = item["correct"] or 0
        item["accuracy"] = round(c * 100.0 / t, 1) if t > 0 else 0.0

    # 3. 错因分布（不含 correct / error）
    error_breakdown = [
        dict(r)
        for r in conn.execute(
            f"""
            SELECT result, COUNT(*) AS count
            FROM attempts
            WHERE {where_sql} AND result != 'correct'
            GROUP BY result
            ORDER BY count DESC
            """,
            params,
        ).fetchall()
    ]

    # 4. AI 细粒度错因诊断分布（含「纠错后做对」保留下来的首错诊断）
    diagnosis_breakdown = [
        {
            "code": r["code"],
            "label": get_diagnosis_label(r["code"]),
            "count": r["count"],
            "corrected_count": int(r["corrected_count"] or 0),
        }
        for r in conn.execute(
            f"""
            SELECT
                diagnosis_code AS code,
                COUNT(*) AS count,
                SUM(CASE WHEN corrected = 1 THEN 1 ELSE 0 END) AS corrected_count
            FROM attempts
            WHERE {where_sql} AND diagnosis_code IS NOT NULL AND diagnosis_code != ''
            GROUP BY diagnosis_code
            ORDER BY count DESC
            """,
            params,
        ).fetchall()
    ]

    # 5. 诊断反馈命中统计（来自 diagnosis_logs）
    fb_where = ["user_id = ?", "created_at >= ?", "feedback IS NOT NULL"]
    fb_params: list[Any] = [user_id, since]
    if topic:
        fb_where.append("topic = ?")
        fb_params.append(topic)
    fb_row = conn.execute(
        f"""
        SELECT
            SUM(CASE WHEN feedback = 1 THEN 1 ELSE 0 END) AS helpful,
            SUM(CASE WHEN feedback = -1 THEN 1 ELSE 0 END) AS unhelpful
        FROM diagnosis_logs
        WHERE {' AND '.join(fb_where)}
        """,
        fb_params,
    ).fetchone()

    return {
        "days": days,
        "total": total,
        "correct": correct,
        "first_try_correct": first_try_correct,
        "corrected": corrected,
        "accuracy": accuracy,
        "first_try_accuracy": first_try_accuracy,
        "gave_up": row["gave_up"] or 0,
        "used_hint": row["used_hint"] or 0,
        "avg_ms": int(row["avg_ms"] or 0),
        "by_topic_level": by_topic_level,
        "error_breakdown": error_breakdown,
        "diagnosis_breakdown": diagnosis_breakdown,
        "diagnosis_feedback": {
            "helpful": int(fb_row["helpful"] or 0) if fb_row else 0,
            "unhelpful": int(fb_row["unhelpful"] or 0) if fb_row else 0,
        },
    }


def get_recent_attempts(
    conn: sqlite3.Connection,
    user_id: int,
    limit: int = 30,
    only_wrong: bool = False,
    topic: str | None = None,
) -> list[dict[str, Any]]:
    """返回最近做题记录（支持仅看错题）。"""
    where = ["user_id = ?", "result != 'error'"]
    params: list[Any] = [user_id]
    if only_wrong:
        where.append("result != 'correct'")
    if topic:
        where.append("topic = ?")
        params.append(topic)
    params.append(max(1, min(limit, 100)))

    rows = conn.execute(
        f"""
        SELECT id, topic, level, question, answer, student_answer,
               result, used_hint, revealed, gave_up, ms, corrected,
               diagnosis_code, diagnosis_confidence, created_at
        FROM attempts
        WHERE {' AND '.join(where)}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        """,
        params,
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["diagnosis_label"] = get_diagnosis_label(d.get("diagnosis_code"))
        out.append(d)
    return out


def get_teacher_students_overview(
    conn: sqlite3.Connection,
    teacher_id: int,
    days: int = 30,
) -> list[dict[str, Any]]:
    """返回绑定到该教师的所有学生及其汇总指标。"""
    since = _since_ts(days)
    rows = conn.execute(
        """
        SELECT
            u.id,
            u.name,
            u.created_at,
            COUNT(a.id) AS total,
            SUM(CASE WHEN a.result = 'correct' THEN 1 ELSE 0 END) AS correct,
            SUM(CASE WHEN a.gave_up = 1 THEN 1 ELSE 0 END) AS gave_up,
            MAX(a.created_at) AS last_active_at
        FROM users u
        LEFT JOIN attempts a
            ON a.user_id = u.id
            AND a.result != 'error'
            AND a.created_at >= ?
        WHERE u.role = 'student' AND u.teacher_id = ?
        GROUP BY u.id
        ORDER BY last_active_at DESC, u.id DESC
        """,
        (since, teacher_id),
    ).fetchall()

    result = []
    for r in rows:
        d = dict(r)
        t = d["total"] or 0
        c = d["correct"] or 0
        d["accuracy"] = round(c * 100.0 / t, 1) if t > 0 else 0.0
        result.append(d)
    return result