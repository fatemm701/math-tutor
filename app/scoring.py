from __future__ import annotations

import sqlite3
import time
from typing import Any


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
    accuracy = round(correct * 100.0 / total, 1) if total > 0 else 0.0

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

    return {
        "days": days,
        "total": total,
        "correct": correct,
        "accuracy": accuracy,
        "gave_up": row["gave_up"] or 0,
        "used_hint": row["used_hint"] or 0,
        "avg_ms": int(row["avg_ms"] or 0),
        "by_topic_level": by_topic_level,
        "error_breakdown": error_breakdown,
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
               result, used_hint, revealed, gave_up, ms, created_at
        FROM attempts
        WHERE {' AND '.join(where)}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        """,
        params,
    ).fetchall()
    return [dict(r) for r in rows]


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