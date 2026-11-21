from fastapi.testclient import TestClient

from app.auth import login_limiter
from app.db import init_db
from app.main import app


def _register_and_login(
    client: TestClient,
    name: str,
    password: str,
    role: str,
    code: str = "",
):
    payload = {"name": name, "password": password, "role": role}
    if role == "teacher":
        payload["teacherInvite"] = code
    elif code:
        payload["inviteCode"] = code

    r = client.post("/api/auth/register", json=payload)
    assert r.status_code == 200 and r.json()["success"], r.text
    return r.json()["data"]


def test_full_drill_and_permission_isolation(monkeypatch, tmp_path):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test_api.db"))
    monkeypatch.setenv("TEACHER_INVITE", "T_SECRET")
    login_limiter._hits.clear()
    init_db()

    # 1. 注册教师 A 与教师 B
    c_t1 = TestClient(app)
    t1 = _register_and_login(c_t1, "teacher_a", "pass1234", "teacher", "T_SECRET")
    t1_code = t1["inviteCode"]

    c_t2 = TestClient(app)
    _register_and_login(c_t2, "teacher_b", "pass1234", "teacher", "T_SECRET")

    # 2. 注册学生 S1（绑定教师 A）
    c_s1 = TestClient(app)
    s1 = _register_and_login(c_s1, "stu_1", "pass1234", "student", t1_code)

    # 3. 学生做一道口算题并主动看解析
    q_res = c_s1.get("/api/drill/arithmetic/next?level=1").json()
    assert q_res["success"]
    token = q_res["data"]["token"]

    g_resp = c_s1.post(
        "/api/drill/arithmetic/giveup",
        json={"token": token, "clientId": "cid-001", "usedHint": False, "ms": 3200},
    )
    assert g_resp.status_code == 200, g_resp.text
    assert g_resp.json()["success"], g_resp.text

    # 4. 学生自查统计准确
    me = c_s1.get("/api/attempts/me/summary?days=7").json()["data"]
    assert me["total"] == 1 and me["gave_up"] == 1 and me["correct"] == 0

    # 5. 权限隔离：学生访问教师接口返回 403
    assert c_s1.get("/api/teacher/students").status_code == 403

    # 6. 权限隔离：教师 B 无法查看教师 A 的学生（返回 404）
    assert c_t2.get(f"/api/teacher/students/{s1['id']}").status_code == 404

    # 7. 教师 A 可以正常查看学生 S1
    t1_view = c_t1.get(f"/api/teacher/students/{s1['id']}").json()
    assert t1_view["success"] and t1_view["data"]["summary"]["total"] == 1