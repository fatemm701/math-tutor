from fractions import Fraction
import random
import pytest

from app.engines import arithmetic
from app.engines.expr_tree import ZERO_KEY, expand, parse_expr
from app.engines.types import Question


@pytest.mark.parametrize("level", [1, 2, 3, 4])
def test_generate_fuzz_1000(level: int):
    rng = random.Random(2026 + level)
    for _ in range(250):
        q = arithmetic.generate(level, rng=rng)
        assert q.topic == "arithmetic"
        assert q.level == level
        assert len(q.steps) >= 1

        # 用 expr_tree 独立求值校验精确性
        poly = expand(parse_expr(q.prompt_raw))
        true_val = poly.get(ZERO_KEY, Fraction(0))
        assert true_val == Fraction(q.meta["value"]), f"题面求值不符: {q.prompt_raw}"

        # 格式匹配约束：小数题答案不含 '/'
        if q.is_decimal:
            assert "/" not in q.answer_raw, f"小数题答案应为小数: {q.answer_raw}"

        # 标准答案必须判对
        res = arithmetic.grade(q, q.answer_raw)
        assert res.is_correct and res.result == "correct"


def test_grade_all_branches():
    q_fixed = Question(
        topic="arithmetic",
        level=3,
        prompt_raw="1/2 + 1/4",
        prompt_tex="\\dfrac{1}{2} + \\dfrac{1}{4}",
        answer_raw="3/4",
        answer_tex="\\dfrac{3}{4}",
        hint="",
        steps=[],
        is_fraction=True,
        meta={"value": "3/4"},
    )

    # 1. correct（最简分数与等价小数均判对）
    for ans in ("3/4", "0.75", ".75", "+3/4"):
        r = arithmetic.grade(q_fixed, ans)
        assert r.result == "correct" and r.is_correct, f"failed on {ans}: {r}"

    # 2. unreduced（未约分或分母为负）
    for ans in ("6/8", "-3/-4", "9/12"):
        r = arithmetic.grade(q_fixed, ans)
        assert r.result == "unreduced" and not r.is_correct, f"failed on {ans}: {r}"

    # 3. wrong
    for ans in ("1/2", "-3/4", "0.7"):
        r = arithmetic.grade(q_fixed, ans)
        assert r.result == "wrong" and not r.is_correct, f"failed on {ans}: {r}"

    # 4. error（空输入、非法字符、未算完的算式、除零）
    for ans in ("", "1/2 + 1/4", "x", "3/0"):
        r = arithmetic.grade(q_fixed, ans)
        assert r.result == "error" and not r.is_correct, f"failed on {ans}: {r}"