import pytest
from fastapi.testclient import TestClient

from app.auth import login_limiter
from app.db import init_db
from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("TEACHER_INVITE", "secret-admin")
    login_limiter._hits.clear()
    init_db()
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["success"] is True


def test_teacher_and_student_register_flow(client):
    # 未带正确管理员口令不能注册老师
    r = client.post("/api/auth/register", json={
        "name": "t_bad", "password": "pass", "role": "teacher", "teacherInvite": "wrong"
    })
    assert r.status_code == 403

    # 正确注册老师，拿到 6 位邀请码
    r = client.post("/api/auth/register", json={
        "name": "teacher1", "password": "pass", "role": "teacher", "teacherInvite": "secret-admin"
    })
    assert r.status_code == 200
    invite_code = r.json()["data"]["inviteCode"]
    assert len(invite_code) == 6

    # 验证 /me
    me = client.get("/api/auth/me").json()
    assert me["success"] is True
    assert me["data"]["name"] == "teacher1"

    # 登出后 /me 返回 401
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401

    # 学生凭邀请码注册
    r = client.post("/api/auth/register", json={
        "name": "stu1", "password": "pass", "role": "student", "inviteCode": invite_code
    })
    assert r.status_code == 200
    assert r.json()["data"]["role"] == "student"


def test_login_rate_limit(client):
    client.post("/api/auth/register", json={
        "name": "stu2", "password": "goodpass", "role": "student"
    })
    client.post("/api/auth/logout")

    for _ in range(10):
        r = client.post("/api/auth/login", json={"name": "stu2", "password": "bad"})
        assert r.status_code == 401

    # 第 11 次触发 429
    r = client.post("/api/auth/login", json={"name": "stu2", "password": "goodpass"})
    assert r.status_code == 429