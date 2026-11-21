from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.db import get_conn
from app import scoring

router = APIRouter(prefix="/api", tags=["dashboard"])


def _require_teacher(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="仅教师账号可访问此接口")
    return user


# ---------- 学生自查（也适用于教师查自己） ----------

@router.get("/attempts/me/summary")
def my_summary(
    days: int = Query(30, ge=0, le=365),
    topic: str | None = Query(None),
    user: dict = Depends(get_current_user),
):
    with get_conn() as conn:
        data = scoring.get_user_summary(conn, user["id"], days=days, topic=topic)
    return {"success": True, "data": data}


@router.get("/attempts/me/recent")
def my_recent(
    limit: int = Query(30, ge=1, le=100),
    only_wrong: bool = Query(False),
    topic: str | None = Query(None),
    user: dict = Depends(get_current_user),
):
    with get_conn() as conn:
        rows = scoring.get_recent_attempts(
            conn, user["id"], limit=limit, only_wrong=only_wrong, topic=topic
        )
    return {"success": True, "data": rows}


# ---------- 教师看板 ----------

@router.get("/teacher/students")
def teacher_students(
    days: int = Query(30, ge=0, le=365),
    teacher: dict = Depends(_require_teacher),
):
    with get_conn() as conn:
        students = scoring.get_teacher_students_overview(conn, teacher["id"], days=days)
        t_row = conn.execute(
            "SELECT invite_code FROM users WHERE id = ?", (teacher["id"],)
        ).fetchone()
    return {
        "success": True,
        "data": {
            "invite_code": t_row["invite_code"] if t_row else "",
            "students": students,
        },
    }


@router.get("/teacher/students/{student_id}")
def teacher_student_detail(
    student_id: int,
    days: int = Query(30, ge=0, le=365),
    only_wrong: bool = Query(False),
    teacher: dict = Depends(_require_teacher),
):
    with get_conn() as conn:
        stu = conn.execute(
            "SELECT id, name, teacher_id FROM users WHERE id = ? AND role = 'student'",
            (student_id,),
        ).fetchone()
        if not stu or stu["teacher_id"] != teacher["id"]:
            raise HTTPException(status_code=404, detail="未找到该学生或无权查看")
        summary = scoring.get_user_summary(conn, student_id, days=days)
        recent = scoring.get_recent_attempts(
            conn, student_id, limit=50, only_wrong=only_wrong
        )
    return {
        "success": True,
        "data": {
            "student": {"id": stu["id"], "name": stu["name"]},
            "summary": summary,
            "recent": recent,
        },
    }