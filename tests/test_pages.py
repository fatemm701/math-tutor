"""页面渲染回归测试：登录页切换结构、软键盘布局与字符集。

这三个线上问题的修复全部落在模板 / CSS / JS 上，接口测试覆盖不到，
这里用 TestClient 直接拉取渲染后的 HTML 做结构断言。
"""

import re

import pytest
from fastapi.testclient import TestClient

from app.auth import login_limiter
from app.db import init_db
from app.main import app

DRILL_PAGES = {"simplify": "/simplify", "equation": "/equation", "arithmetic": "/arithmetic"}

# 软键盘前 3 行必须在所有题型中完全一致：数字 1-9 的物理位置不能因题型而变
COMMON_ROWS = (["7", "8", "9", "⌫"], ["4", "5", "6", "清空"], ["1", "2", "3", "−"])


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test_pages.db"))
    monkeypatch.setenv("TEACHER_INVITE", "secret-admin")
    login_limiter._hits.clear()
    init_db()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def logged_in(client):
    r = client.post(
        "/api/auth/register",
        json={"name": "page_stu", "password": "pass1234", "role": "student"},
    )
    assert r.status_code == 200 and r.json()["success"], r.text
    return client


def _keys(html: str) -> list[str]:
    """按 DOM 顺序取出软键盘上的每个按键文本。"""
    kb = re.search(r'<div class="soft-keyboard" id="soft-keyboard">(.*?)</div>\s*</section>', html, re.S)
    assert kb, "页面里找不到软键盘容器"
    return [m.strip() for m in re.findall(r'<button[^>]*class="kb-key[^"]*"[^>]*>(.*?)</button>', kb.group(1), re.S)]


def _ins_values(html: str) -> list[str]:
    return re.findall(r'data-ins="([^"]*)"', html)


# ---------- 登录页 ----------

def test_login_page_only_shows_login_pane(client):
    html = client.get("/").text

    # 左右滑动切换的骨架
    assert 'class="auth-slider"' in html
    assert 'class="auth-track"' in html
    assert 'id="pane-login"' in html and 'id="pane-register"' in html

    # 无障碍语义：tablist / tab / tabpanel，且初始选中登录
    assert 'role="tablist"' in html
    tab_login = re.search(r'id="tab-login"[^>]*', html)
    tab_register = re.search(r'id="tab-register"[^>]*', html)
    assert tab_login and 'aria-selected="true"' in tab_login.group(0)
    assert tab_register and 'aria-selected="false"' in tab_register.group(0)

    # 注册面板初始必须隐藏，不能和登录表单同屏堆叠
    assert 'class="auth-pane is-hidden"' in html


def test_login_page_has_globle_hidden_rule(client):
    css = client.get("/static/css/app.css").text
    assert re.search(r"\[hidden\]\s*\{\s*display:\s*none\s*!important;", css), (
        "缺少 [hidden]{display:none!important}，class 上的 display 会覆盖 hidden 属性"
    )


def test_login_page_slider_css_present(client):
    css = client.get("/static/css/app.css").text
    assert ".auth-card.is-register .auth-track" in css and "translateX(-100%)" in css
    assert "@media (prefers-reduced-motion: reduce)" in css


# ---------- 练习页软键盘 ----------

@pytest.mark.parametrize("topic", sorted(DRILL_PAGES))
def test_drill_page_renders(logged_in, topic):
    r = logged_in.get(DRILL_PAGES[topic])
    assert r.status_code == 200
    keys = _keys(r.text)
    assert len(keys) % 4 == 0, f"{topic} 的键数 {len(keys)} 不是 4 的倍数，4 列布局会缺格"
    # 前 3 行必须与全站统一布局一致
    for row_idx, expected in enumerate(COMMON_ROWS):
        assert keys[row_idx * 4:(row_idx + 1) * 4] == expected, f"{topic} 第 {row_idx + 1} 行布局不对"


def test_equation_keyboard_has_parentheses(logged_in):
    ins = _ins_values(logged_in.get("/equation").text)
    assert "(" in ins and ")" in ins, "一元一次方程需要括号键，例如 3(x-2)=x+4"
    assert "=" in ins


@pytest.mark.parametrize("topic", sorted(DRILL_PAGES))
def test_keyboard_keys_are_unique(logged_in, topic):
    ins = _ins_values(logged_in.get(DRILL_PAGES[topic]).text)
    assert len(ins) == len(set(ins)), f"{topic} 键盘里有重复的输入键"


def test_arithmetic_keyboard_covers_required_symbols(logged_in):
    ins = _ins_values(logged_in.get("/arithmetic").text)
    for sym in ("0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "−", "+", "/", "."):
        assert sym in ins, f"口算键盘缺少 {sym}"


def test_simplify_keyboard_covers_variables_and_powers(logged_in):
    ins = _ins_values(logged_in.get("/simplify").text)
    assert "x" in ins and "y" in ins
    assert "(" in ins and ")" in ins
    assert "^2" in ins


# ---------- 触屏不弹系统键盘 ----------

def test_drill_js_does_not_focus_on_touch():
    """触屏上不能无条件 focus 输入框，否则会唤出系统键盘。"""
    src = open("app/static/js/drill.js", encoding="utf-8").read()
    assert "finePointer.matches" in src
    assert "LONG_PRESS_MS" in src
    # 出题后的自动聚焦只允许发生在精准指针（桌面）上
    assert "if (finePointer.matches) elInput.focus();" in src
    # 除长按唤出系统键盘外，没有任何别处可以 focus
    assert src.count("elInput.focus();") == 2
    assert "elInput.focus(); // 长按才唤出系统键盘" in src