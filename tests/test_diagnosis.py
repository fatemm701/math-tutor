from __future__ import annotations

from fractions import Fraction
import random
import sqlite3

from fastapi.testclient import TestClient

from app.auth import login_limiter
from app.db import init_db
from app.diagnosis import (
    DEFAULT_ARITHMETIC_MODEL_PATH,
    DEFAULT_EQUATION_MODEL_PATH,
    DEFAULT_SIMPLIFY_MODEL_PATH,
    EQUATION_BUG_CODES,
    diagnose_arithmetic,
    diagnose_equation,
    diagnose_simplify,
    load_arithmetic_model,
    load_equation_model,
    load_simplify_model,
)
from app.diagnosis.equation_sim import analyze_equation_meta, simulate_bug_candidates
from app.diagnosis.tree_infer import PureTreeModel
from app.engines import arithmetic, equation, simplify
from app.engines.expr_tree import expand, parse_expr
from app.engines.types import Question
from app.main import app


def _make_eq_question(
    level: int,
    lhs: list[dict],
    rhs: list[dict],
    solution: str,
    lcm: int = 1,
) -> Question:
    return Question(
        topic="equation",
        level=level,
        prompt_raw="test = eq",
        prompt_tex="test = eq",
        answer_raw=f"x = {solution}",
        answer_tex=f"x = {solution}",
        hint="",
        steps=[],
        meta={"solution": solution, "lhs": lhs, "rhs": rhs, "lcm": lcm},
    )


def test_model_file_loads_and_supports_rf_inference():
    assert DEFAULT_EQUATION_MODEL_PATH.exists(), "应已导出 equation_gbdt.json"
    model = load_equation_model(force_reload=True)
    assert model is not None
    assert model.model_type == "gbdt"

    # 验证纯 Python RandomForest 分支推理同样正确
    rf_payload = {
        "model_type": "rf",
        "classes": ["a", "b", "c"],
        "feature_names": ["x0", "x1"],
        "trees": [
            [0, 0.5, [0.8, 0.1, 0.1], [0.1, 0.7, 0.2]],
            [1, 1.0, [0.6, 0.3, 0.1], [0.2, 0.5, 0.3]],
        ],
    }
    rf = PureTreeModel(rf_payload)
    p = rf.predict_proba([0.2, 0.5])
    assert abs(p["a"] - 0.7) < 1e-6
    assert abs(p["b"] - 0.2) < 1e-6
    assert abs(p["c"] - 0.1) < 1e-6


def test_diagnose_typical_misconceptions():
    # 1. L1: 3x - 5 = x + 7 -> 2x = 12 -> x = 6
    q_l1 = _make_eq_question(
        level=1,
        lhs=[
            {"outer": 3, "inner_x": 1, "inner_c": 0, "den": 1, "is_paren": False},
            {"outer": -5, "inner_x": 0, "inner_c": 1, "den": 1, "is_paren": False},
        ],
        rhs=[
            {"outer": 1, "inner_x": 1, "inner_c": 0, "den": 1, "is_paren": False},
            {"outer": 7, "inner_x": 0, "inner_c": 1, "den": 1, "is_paren": False},
        ],
        solution="6",
    )
    # 移项漏变号: -5 移到右边仍为 -5 => 2x = 2 => x = 1
    d_trans = diagnose_equation(q_l1, Fraction(1))
    assert d_trans is not None and d_trans.code == "transpose_sign"
    assert d_trans.confidence >= 0.5

    # 符号弄反: x = -6
    d_sign = diagnose_equation(q_l1, Fraction(-6))
    assert d_sign is not None and d_sign.code == "sign_flip"

    # 系数化为 1 误用减法: 2x = 12 => x = 12 - 2 = 10
    d_sub = diagnose_equation(q_l1, Fraction(10))
    assert d_sub is not None and d_sub.code == "coeff_sub_div"

    # 2. L2: 2(x - 3) - (x - 4) = 5 -> x - 2 = 5 -> x = 7
    q_l2 = _make_eq_question(
        level=2,
        lhs=[
            {"outer": 2, "inner_x": 1, "inner_c": -3, "den": 1, "is_paren": True},
            {"outer": -1, "inner_x": 1, "inner_c": -4, "den": 1, "is_paren": True},
        ],
        rhs=[
            {"outer": 5, "inner_x": 0, "inner_c": 1, "den": 1, "is_paren": False},
        ],
        solution="7",
    )
    # 去括号漏乘后项: 2(x-3) -> 2x - 3 => x + 1 = 5 => x = 4
    d_omit = diagnose_equation(q_l2, Fraction(4))
    assert d_omit is not None and d_omit.code == "paren_omit_mul"

    # 3. L3: (x - 1)/2 + (x + 2)/3 = 2 (lcm=6) -> 3x-3 + 2x+4 = 12 -> 5x = 11 -> x = 11/5
    q_l3 = _make_eq_question(
        level=3,
        lhs=[
            {"outer": 1, "inner_x": 1, "inner_c": -1, "den": 2, "is_paren": False},
            {"outer": 1, "inner_x": 1, "inner_c": 2, "den": 3, "is_paren": False},
        ],
        rhs=[
            {"outer": 2, "inner_x": 0, "inner_c": 1, "den": 1, "is_paren": False},
        ],
        solution="11/5",
        lcm=6,
    )
    # 去分母漏乘右边常数 2: 5x + 1 = 2 => x = 1/5
    d_denom_omit = diagnose_equation(q_l3, Fraction(1, 5))
    assert d_denom_omit is not None and d_denom_omit.code == "denom_omit_const"

    # 去分母直接擦掉分母: (x-1) + (x+2) = 2 => 2x = 1 => x = 1/2
    d_denom_mul = diagnose_equation(q_l3, Fraction(1, 2))
    assert d_denom_mul is not None and d_denom_mul.code == "denom_mul_error"

    # 系数化为 1 分子分母颠倒: 5x = 11 => x = 5/11
    d_inv = diagnose_equation(q_l3, Fraction(5, 11))
    assert d_inv is not None and d_inv.code == "coeff_invert"

    # 明显随机离谱答案应诚实回退 (返回 None)，不瞎猜
    d_rand = diagnose_equation(q_l3, Fraction(999))
    assert d_rand is None


def test_diagnose_graceful_when_meta_incomplete():
    q = Question(
        topic="equation",
        level=1,
        prompt_raw="2x = 4",
        prompt_tex="2x = 4",
        answer_raw="x = 2",
        answer_tex="x = 2",
        hint="",
        steps=[],
        meta={"solution": "2"},
    )
    res = equation.grade(q, "x = 5")
    assert res.result == "wrong" and res.diagnosis is None


def test_end_to_end_diagnosis_feedback_and_dashboard(monkeypatch, tmp_path):
    db_file = tmp_path / "test_diag.db"
    monkeypatch.setenv("DB_PATH", str(db_file))
    monkeypatch.setenv("TEACHER_INVITE", "T_DIAG")
    login_limiter._hits.clear()
    init_db()

    # 注册教师与两名学生
    c_teacher = TestClient(app)
    t = c_teacher.post(
        "/api/auth/register",
        json={"name": "diag_teacher", "password": "pass1234", "role": "teacher", "teacherInvite": "T_DIAG"},
    ).json()["data"]

    c_stu1 = TestClient(app)
    s1 = c_stu1.post(
        "/api/auth/register",
        json={"name": "diag_stu1", "password": "pass1234", "role": "student", "inviteCode": t["inviteCode"]},
    ).json()["data"]

    c_stu2 = TestClient(app)
    c_stu2.post(
        "/api/auth/register",
        json={"name": "diag_stu2", "password": "pass1234", "role": "student", "inviteCode": t["inviteCode"]},
    )

    # 拉取一道 L3 方程题，并从服务端缓存取出题目的模拟错因答案（确保触发有效诊断）
    from app.routers.drill import _question_cache

    q_resp = c_stu1.get("/api/drill/equation/next?level=3").json()
    assert q_resp["success"]
    token = q_resp["data"]["token"]
    _, q_obj = _question_cache[token]
    analysis = analyze_equation_meta(q_obj.meta)
    assert analysis is not None
    cands = simulate_bug_candidates(analysis)
    # 挑一个确定可用的错因候选值（优先 denom_omit_const / denom_mul_error / transpose_sign）
    wrong_val = None
    for code in ("denom_omit_const", "denom_mul_error", "transpose_sign", "sign_flip"):
        if cands[code]:
            wrong_val = cands[code][0].value
            break
    assert wrong_val is not None
    wrong_str = f"x = {wrong_val}"

    # 第 1 次答错：返回诊断与 logId，不锁定
    r1 = c_stu1.post(
        "/api/drill/equation/submit",
        json={
            "token": token,
            "clientId": "diag-cid-1",
            "studentAnswer": wrong_str,
            "attemptNum": 1,
            "ms": 2100,
        },
    ).json()
    assert r1["success"]
    d1 = r1["data"]
    assert d1["result"] == "wrong" and not d1["locked"]
    assert d1.get("diagnosis") is not None
    log_id = d1["diagnosis"]["logId"]
    assert log_id and d1["diagnosis"]["code"] in EQUATION_BUG_CODES

    # 权限隔离：stu2 无法对 stu1 的 logId 提交反馈
    fb_other = c_stu2.post(
        "/api/drill/diagnosis/feedback",
        json={"logId": log_id, "helpful": False},
    )
    assert fb_other.status_code == 404

    # stu1 提交「猜中了」反馈
    fb_ok = c_stu1.post(
        "/api/drill/diagnosis/feedback",
        json={"logId": log_id, "helpful": True},
    )
    assert fb_ok.status_code == 200 and fb_ok.json()["data"]["feedback"] == 1

    # 第 2 次答错：锁定并写入 attempts.diagnosis_code
    r2 = c_stu1.post(
        "/api/drill/equation/submit",
        json={
            "token": token,
            "clientId": "diag-cid-1",
            "studentAnswer": wrong_str,
            "attemptNum": 2,
            "ms": 4200,
        },
    ).json()
    assert r2["success"] and r2["data"]["locked"]

    # 学生自查看板应统计出细粒度错因与反馈数
    summary = c_stu1.get("/api/attempts/me/summary?days=7").json()["data"]
    assert len(summary["diagnosis_breakdown"]) == 1
    assert summary["diagnosis_breakdown"][0]["count"] == 1
    assert summary["diagnosis_feedback"]["helpful"] == 1

    recent = c_stu1.get("/api/attempts/me/recent?only_wrong=true").json()["data"]
    assert len(recent) == 1
    assert recent[0]["diagnosis_code"] == d1["diagnosis"]["code"]
    assert recent[0]["diagnosis_label"]

    # 教师端也能看到该学生的细粒度错因分布
    t_detail = c_teacher.get(f"/api/teacher/students/{s1['id']}?days=7").json()["data"]
    assert len(t_detail["summary"]["diagnosis_breakdown"]) == 1


def test_legacy_db_migration_adds_diagnosis_columns(monkeypatch, tmp_path):
    legacy_db = tmp_path / "legacy.db"
    conn = sqlite3.connect(legacy_db)
    conn.executescript(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            invite_code TEXT UNIQUE,
            teacher_id INTEGER,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            topic TEXT NOT NULL,
            level INTEGER NOT NULL,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            student_answer TEXT NOT NULL,
            result TEXT NOT NULL,
            used_hint INTEGER NOT NULL DEFAULT 0,
            revealed INTEGER NOT NULL DEFAULT 0,
            gave_up INTEGER NOT NULL DEFAULT 0,
            is_fraction INTEGER NOT NULL DEFAULT 0,
            is_decimal INTEGER NOT NULL DEFAULT 0,
            ms INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        """
    )
    conn.close()

    monkeypatch.setenv("DB_PATH", str(legacy_db))
    init_db()

    conn = sqlite3.connect(legacy_db)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(attempts)").fetchall()}
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    conn.close()

    assert "corrected" in cols
    assert "diagnosis_code" in cols
    assert "diagnosis_confidence" in cols
    assert "diagnosis_logs" in tables


def test_option_c_spoiler_guard_and_corrected_attempt_preserves_diagnosis(monkeypatch, tmp_path):
    from app.diagnosis import diagnosis_to_dict
    from app.routers.drill import _question_cache

    monkeypatch.setenv("DB_PATH", str(tmp_path / "test_opt_c.db"))
    monkeypatch.setenv("TEACHER_INVITE", "T_C")
    login_limiter._hits.clear()
    init_db()

    # 1. sign_flip 第 1 次答错防剧透校验
    q_l1 = _make_eq_question(
        level=1,
        lhs=[
            {"outer": 3, "inner_x": 1, "inner_c": 0, "den": 1, "is_paren": False},
            {"outer": -5, "inner_x": 0, "inner_c": 1, "den": 1, "is_paren": False},
        ],
        rhs=[
            {"outer": 1, "inner_x": 1, "inner_c": 0, "den": 1, "is_paren": False},
            {"outer": 7, "inner_x": 0, "inner_c": 1, "den": 1, "is_paren": False},
        ],
        solution="6",
    )
    d_sign = diagnose_equation(q_l1, Fraction(-6))
    assert d_sign is not None and d_sign.code == "sign_flip"
    soft = diagnosis_to_dict(d_sign, log_id=1, allow_spoiler=False)
    full = diagnosis_to_dict(d_sign, log_id=1, allow_spoiler=True)
    assert soft is not None and full is not None
    assert "数值大小算对了" not in soft["detail"]
    assert "数值大小算对了" in full["detail"]

    # 2. 第 1 次犯错 -> 第 2 次改对：应记为 corrected=1 且保留首错诊断
    client = TestClient(app)
    client.post(
        "/api/auth/register",
        json={"name": "stu_opt_c", "password": "pass1234", "role": "student"},
    )
    q_resp = client.get("/api/drill/equation/next?level=1").json()
    token = q_resp["data"]["token"]
    _, q_obj = _question_cache[token]
    analysis = analyze_equation_meta(q_obj.meta)
    assert analysis is not None
    cands = simulate_bug_candidates(analysis)
    wrong_val = None
    for code in ("transpose_sign", "coeff_sub_div", "sign_flip"):
        if cands[code]:
            wrong_val = cands[code][0].value
            break
    assert wrong_val is not None

    r1 = client.post(
        "/api/drill/equation/submit",
        json={
            "token": token,
            "clientId": "cid-opt-c",
            "studentAnswer": f"x = {wrong_val}",
            "attemptNum": 1,
            "ms": 1500,
        },
    ).json()["data"]
    assert r1["result"] == "wrong" and not r1["locked"]
    assert r1["diagnosis"] is not None
    first_diag_code = r1["diagnosis"]["code"]

    r2 = client.post(
        "/api/drill/equation/submit",
        json={
            "token": token,
            "clientId": "cid-opt-c",
            "studentAnswer": q_obj.answer_raw,
            "attemptNum": 2,
            "ms": 3000,
        },
    ).json()["data"]
    assert r2["isCorrect"] and r2["locked"] and r2["corrected"]

    summary = client.get("/api/attempts/me/summary?days=7").json()["data"]
    assert summary["total"] == 1
    assert summary["correct"] == 1
    assert summary["first_try_correct"] == 0
    assert summary["corrected"] == 1
    assert summary["accuracy"] == 100.0
    assert summary["first_try_accuracy"] == 0.0
    assert len(summary["diagnosis_breakdown"]) == 1
    assert summary["diagnosis_breakdown"][0]["code"] == first_diag_code
    assert summary["diagnosis_breakdown"][0]["corrected_count"] == 1

    recent = client.get("/api/attempts/me/recent").json()["data"]
    assert len(recent) == 1
    assert recent[0]["corrected"] == 1
    assert recent[0]["diagnosis_code"] == first_diag_code
    assert recent[0]["diagnosis_label"]


def test_simplify_diagnosis_typical_misconceptions():
    assert DEFAULT_SIMPLIFY_MODEL_PATH.exists()
    assert load_simplify_model(force_reload=True) is not None

    # 2(3x - 4) - (x - 5) = 5x - 3
    q = Question(
        topic="simplify",
        level=2,
        prompt_raw="2(3x - 4) - (x - 5)",
        prompt_tex="2(3x - 4) - (x - 5)",
        answer_raw="5x - 3",
        answer_tex="5x - 3",
        hint="",
        steps=[],
        meta={
            "groups": [
                {"coeff": "2", "is_paren": True, "terms": [[[1, 0, 0, 0], "3"], [[0, 0, 0, 0], "-4"]]},
                {"coeff": "-1", "is_paren": True, "terms": [[[1, 0, 0, 0], "1"], [[0, 0, 0, 0], "-5"]]},
            ]
        },
    )

    # 1. 去括号漏变号: -(x - 5) 错展成 -x - 5 => 6x - 8 - x - 5 = 5x - 13
    r_ps = simplify.grade(q, "5x - 13")
    assert r_ps.result == "wrong" and r_ps.diagnosis is not None
    assert r_ps.diagnosis.code == "simp_paren_sign"

    # 2. 分配律漏乘后项: 2(3x - 4) 错展成 6x - 4 => 6x - 4 - x + 5 = 5x + 1
    r_om = simplify.grade(q, "5x + 1")
    assert r_om.result == "wrong" and r_om.diagnosis is not None
    assert r_om.diagnosis.code == "simp_omit_mul"

    # 3. 误合并非同类项: 5x - 3 错并成 2x
    r_mix = simplify.grade(q, "2x")
    assert r_mix.result == "wrong" and r_mix.diagnosis is not None
    assert r_mix.diagnosis.code == "simp_mix_unlike"

    # 4. 整体符号弄反: -5x + 3
    r_sign = simplify.grade(q, "-5x + 3")
    assert r_sign.result == "wrong" and r_sign.diagnosis is not None
    assert r_sign.diagnosis.code == "simp_sign_all"

    # 5. 明显胡写应回退 None
    r_rand = simplify.grade(q, "99x^2 - 77x + 123")
    assert r_rand.result == "wrong" and r_rand.diagnosis is None


def test_arithmetic_diagnosis_typical_misconceptions():
    assert DEFAULT_ARITHMETIC_MODEL_PATH.exists()
    assert load_arithmetic_model(force_reload=True) is not None

    # 1. L1 整数乘除: (-12) / 3 * 2 = -8，先算后面乘法得 -12 / 6 = -2
    q_order = Question(
        topic="arithmetic",
        level=1,
        prompt_raw="(-12) / 3 * 2",
        prompt_tex="(-12) \\div 3 \\times 2",
        answer_raw="-8",
        answer_tex="-8",
        hint="",
        steps=[],
        meta={"value": "-8", "kind": "l1_mul_div", "a": -12, "d": 3, "c": 2},
    )
    r_ord = arithmetic.grade(q_order, "-2")
    assert r_ord.result == "wrong" and r_ord.diagnosis is not None
    assert r_ord.diagnosis.code == "arith_order_ops"

    # 2. L3 异分母分数加减: 1/2 + 1/3 = 5/6，分子分母直接相加得 2/5
    q_frac = Question(
        topic="arithmetic",
        level=3,
        prompt_raw="1/2 + 1/3",
        prompt_tex="\\dfrac{1}{2} + \\dfrac{1}{3}",
        answer_raw="5/6",
        answer_tex="\\dfrac{5}{6}",
        hint="",
        steps=[],
        is_fraction=True,
        meta={"value": "5/6", "kind": "l3_frac_add_sub", "f1": "1/2", "f2": "1/3", "op": "+"},
    )
    r_fr = arithmetic.grade(q_frac, "2/5")
    assert r_fr.result == "wrong" and r_fr.diagnosis is not None
    assert r_fr.diagnosis.code == "arith_frac_add_raw"

    # 3. L3 分数乘除: 2/3 / (4/5) * (1/2) = 5/12，忘取倒数直接乘得 4/15
    q_fdiv = Question(
        topic="arithmetic",
        level=3,
        prompt_raw="2/3 / 4/5 * 1/2",
        prompt_tex="\\dfrac{2}{3} \\div \\dfrac{4}{5} \\times \\dfrac{1}{2}",
        answer_raw="5/12",
        answer_tex="\\dfrac{5}{12}",
        hint="",
        steps=[],
        is_fraction=True,
        meta={"value": "5/12", "kind": "l3_frac_mul_div", "f1": "2/3", "f2": "4/5", "f3": "1/2"},
    )
    r_fd = arithmetic.grade(q_fdiv, "4/15")
    assert r_fd.result == "wrong" and r_fd.diagnosis is not None
    assert r_fd.diagnosis.code == "arith_frac_div_no_inv"

    # 4. L4 乘方混合: -2^2 + (-3)^2 * 2 - (-4) = -4 + 18 + 4 = 18
    # 混淆 -2^2 为 +4 => 4 + 18 + 4 = 26
    q_pow = Question(
        topic="arithmetic",
        level=4,
        prompt_raw="-2^2 + (-3)^2 * 2 - (-4)",
        prompt_tex="-2^{2} + (-3)^{2} \\times 2 - (-4)",
        answer_raw="18",
        answer_tex="18",
        hint="",
        steps=[],
        meta={
            "value": "18",
            "kind": "l4_power_mix",
            "base1": 2,
            "exp1": 2,
            "neg_outside": True,
            "base2": -3,
            "m": 2,
            "c": -4,
        },
    )
    r_pow = arithmetic.grade(q_pow, "26")
    assert r_pow.result == "wrong" and r_pow.diagnosis is not None
    assert r_pow.diagnosis.code == "arith_power_sign"

    # 5. L2 小数凑整: 0.25 * 3.2 * 4 = 3.2，小数点位错算成 32
    q_dec = Question(
        topic="arithmetic",
        level=2,
        prompt_raw="0.25 * 3.2 * 4",
        prompt_tex="0.25 \\times 3.2 \\times 4",
        answer_raw="3.2",
        answer_tex="3.2",
        hint="",
        steps=[],
        is_decimal=True,
        meta={"value": "16/5", "kind": "l2_mul_pair", "p1": "1/4", "mid": "16/5", "p2": "4"},
    )
    r_dec = arithmetic.grade(q_dec, "32")
    assert r_dec.result == "wrong" and r_dec.diagnosis is not None
    assert r_dec.diagnosis.code == "arith_decimal_place"

    # 6. 随机胡写应回退 None
    r_rand = arithmetic.grade(q_pow, "777")
    assert r_rand.result == "wrong" and r_rand.diagnosis is None
