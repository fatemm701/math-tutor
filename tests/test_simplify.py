import random
import pytest

from app.engines.expr_tree import expand, parse_expr
from app.engines.simplify import generate, grade
from app.engines.types import Question


@pytest.mark.parametrize("level", [1, 2, 3, 4])
def test_generate_and_grade_fuzz(level):
    rng = random.Random(202600 + level)
    frac_count = 0
    total_runs = 250

    for _ in range(total_runs):
        q = generate(level, rng=rng)
        assert q.topic == "simplify"
        assert q.level == level
        assert len(q.steps) == 2

        # 题面展开必须与标准答案完全等价
        assert expand(parse_expr(q.prompt_raw)) == expand(parse_expr(q.answer_raw))

        # 分数标签必须名副其实
        if level == 1:
            assert q.is_fraction is False
            assert "/" not in q.prompt_raw
        if q.is_fraction:
            frac_count += 1
            assert "/" in q.prompt_raw
            assert r"\dfrac" in q.prompt_tex
        else:
            assert "/" not in q.prompt_raw

        # ①②③ 仅含 x，不含 y
        if level in (1, 2, 3):
            assert "y" not in q.prompt_raw
            assert "y" not in q.answer_raw

        # 标准答案必须判对
        res_ok = grade(q, q.answer_raw)
        assert res_ok.result == "correct"
        assert res_ok.is_correct is True

        # 原题面含括号，提交原题面必须判 parentheses
        res_paren = grade(q, q.prompt_raw)
        assert res_paren.result == "parentheses"
        assert res_paren.is_correct is False

    # 校验分数题混入比例大致合理（L2~L4 均有分数题）
    if level >= 2:
        assert frac_count > 0


def test_grade_all_branches():
    q = Question(
        topic="simplify",
        level=2,
        prompt_raw="2(x + 3) - (x - 1)",
        prompt_tex=r"2\left(x + 3\right) - \left(x - 1\right)",
        answer_raw="x + 7",
        answer_tex="x + 7",
        hint="",
        steps=[],
    )

    # 1. 正确（含交换律顺序不同）
    assert grade(q, "x + 7").result == "correct"
    assert grade(q, "7 + x").result == "correct"

    # 2. 没去括号
    r_p = grade(q, "(x + 7)")
    assert r_p.result == "parentheses" and not r_p.is_correct

    # 3. 没合并同类项
    r_u = grade(q, "2x - x + 7")
    assert r_u.result == "unmerged" and not r_u.is_correct

    # 4. 错
    r_w = grade(q, "x + 5")
    assert r_w.result == "wrong" and not r_w.is_correct

    # 5. 格式错（含等号、空串、非法语法）
    assert grade(q, "x = 7").result == "error"
    assert grade(q, "").result == "error"
    assert grade(q, "x + * 7").result == "error"


def test_fraction_and_legacy_ab_compat():
    q_frac = Question(
        topic="simplify",
        level=2,
        prompt_raw="1/2(x + 2) + 1/4",
        prompt_tex="",
        answer_raw="1/2x + 5/4",
        answer_tex="",
        hint="",
        steps=[],
        is_fraction=True,
    )
    assert grade(q_frac, "1/2x + 5/4").result == "correct"
    assert grade(q_frac, "5/4 + 1/2x").result == "correct"

    # 兼容旧记录 a/b 变量
    q_ab = Question(
        topic="simplify",
        level=4,
        prompt_raw="2(a + b) - a",
        prompt_tex="",
        answer_raw="a + 2b",
        answer_tex="",
        hint="",
        steps=[],
    )
    assert grade(q_ab, "2b + a").result == "correct"