from fractions import Fraction
import random
import pytest

from app.engines import equation
from app.engines.expr_tree import ZERO_KEY, expand, parse_expr, poly_sub
from app.engines.rational import frac_to_raw

X_KEY = (1, 0, 0, 0)


@pytest.mark.parametrize("level", [1, 2, 3, 4])
def test_generate_fuzz_1000(level: int):
    """每档生成 250 题（共 1000 题），独立解析题面验证唯一解与标准答案一致。"""
    rng = random.Random(2026 + level)
    for _ in range(250):
        q = equation.generate(level, rng=rng)
        assert q.topic == "equation"
        assert q.level == level
        assert "=" in q.prompt_raw
        assert len(q.steps) >= 1

        lhs_str, rhs_str = q.prompt_raw.split("=")
        diff = poly_sub(expand(parse_expr(lhs_str)), expand(parse_expr(rhs_str)))
        a = diff.get(X_KEY, Fraction(0))
        b = diff.get(ZERO_KEY, Fraction(0))
        assert a != 0, f"退化方程: {q.prompt_raw}"
        true_x = -b / a
        assert true_x == Fraction(q.meta["solution"])
        assert q.answer_raw == f"x = {frac_to_raw(true_x)}"

        # 标准答案必须判对
        res = equation.grade(q, q.answer_raw)
        assert res.is_correct and res.result == "correct"


def test_grade_all_branches():
    # 构造一个确定解为 3/2 的题目对象进行全分支测试
    rng = random.Random(42)
    q = equation.generate(3, rng=rng)
    # 覆盖 meta 中的 solution 为 3/2 便于精确断言
    q_fixed = equation.Question(
        topic="equation",
        level=3,
        prompt_raw="2x = 3",
        prompt_tex="2x = 3",
        answer_raw="x = 3/2",
        answer_tex="x = \\dfrac{3}{2}",
        hint="",
        steps=[],
        meta={"solution": "3/2"},
    )

    # 1. correct：等式 / 反写等式 / 纯分数 / 等价小数
    for ans in ("x = 3/2", "3/2 = x", "3/2", "1.5", "x = 1.5"):
        r = equation.grade(q_fixed, ans)
        assert r.result == "correct" and r.is_correct, f"failed on {ans}: {r}"

    # 2. unisolated：同解但未化系数为 1，或右端未算完
    for ans in ("2x = 3", "4x - 6 = 0", "x - 1 = 1/2", "x = 1 + 1/2", "1 + 1/2"):
        r = equation.grade(q_fixed, ans)
        assert r.result == "unisolated" and not r.is_correct, f"failed on {ans}: {r}"

    # 3. unreduced：数值对但未约分或分母为负
    for ans in ("6/4", "x = 6/4", "x = -3/-2", "-3/-2"):
        r = equation.grade(q_fixed, ans)
        assert r.result == "unreduced" and not r.is_correct, f"failed on {ans}: {r}"

    # 4. wrong：数值错
    for ans in ("2", "x = -3/2", "2x = 4"):
        r = equation.grade(q_fixed, ans)
        assert r.result == "wrong" and not r.is_correct, f"failed on {ans}: {r}"

    # 5. error：语法错 / 空输入 / 多等号 / 非法变量
    for ans in ("", "x = = 1", "x =", "y = 3/2", "x = 3/0", "2x"):
        r = equation.grade(q_fixed, ans)
        assert r.result == "error" and not r.is_correct, f"failed on {ans}: {r}"