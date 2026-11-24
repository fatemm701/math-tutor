from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
import random

from app.diagnosis.predictor import diagnose_simplify
from app.engines.expr_tree import (
    MonoKey,
    ParseError,
    Poly,
    ZERO_KEY,
    expand,
    format_mono_vars,
    format_poly,
    has_parentheses,
    has_unmerged_like_terms,
    node_to_tex,
    parse_expr,
    poly_add,
    poly_clean,
    poly_mul,
)
from app.engines.rational import frac_to_raw, frac_to_tex
from app.engines.types import GradeResult, Question, Step

# 常用单项式键：(x, y, a, b)
K_CONST: MonoKey = (0, 0, 0, 0)
K_X: MonoKey = (1, 0, 0, 0)
K_X2: MonoKey = (2, 0, 0, 0)
K_Y: MonoKey = (0, 1, 0, 0)
K_Y2: MonoKey = (0, 2, 0, 0)
K_XY: MonoKey = (1, 1, 0, 0)

FRAC_PROB: dict[int, float] = {1: 0.0, 2: 0.25, 3: 0.40, 4: 0.50}
FRAC_POOL = [
    Fraction(1, 2), Fraction(-1, 2),
    Fraction(1, 3), Fraction(-1, 3),
    Fraction(2, 3), Fraction(-2, 3),
    Fraction(1, 4), Fraction(-1, 4),
    Fraction(3, 4), Fraction(-3, 4),
    Fraction(3, 2), Fraction(-3, 2),
]


@dataclass(frozen=True)
class BracketGroup:
    coeff: Fraction
    inner: Poly
    is_paren: bool = True  # False 表示裸项（不加括号）


def _rand_int(rng: random.Random, lo: int, hi: int, exclude_zero: bool = True) -> Fraction:
    while True:
        v = rng.randint(lo, hi)
        if not exclude_zero or v != 0:
            return Fraction(v)


def _rand_coeff(rng: random.Random, allow_frac: bool, lo: int, hi: int) -> Fraction:
    if allow_frac and rng.random() < 0.45:
        return rng.choice(FRAC_POOL)
    return _rand_int(rng, lo, hi, exclude_zero=True)


def _make_inner_poly(
    rng: random.Random,
    keys: list[MonoKey],
    allow_frac: bool,
    lo: int,
    hi: int,
) -> Poly:
    p: Poly = {}
    for k in keys:
        p[k] = _rand_coeff(rng, allow_frac, lo, hi)
    return poly_clean(p)


def _has_real_fraction(groups: list[BracketGroup]) -> bool:
    for g in groups:
        if g.coeff.denominator != 1:
            return True
        if any(c.denominator != 1 for c in g.inner.values()):
            return True
    return False


def _format_groups(groups: list[BracketGroup], tex: bool = False) -> str:
    parts: list[str] = []
    for i, g in enumerate(groups):
        if not g.is_paren:
            # 裸项直接格式化
            expanded = poly_mul({ZERO_KEY: g.coeff}, g.inner)
            s = format_poly(expanded, tex=tex)
            if i == 0:
                parts.append(s)
            else:
                if s.startswith("-"):
                    parts.append(f" - {s[1:]}")
                else:
                    parts.append(f" + {s}")
            continue

        inner_str = format_poly(g.inner, tex=tex)
        neg = g.coeff < 0
        abs_c = -g.coeff if neg else g.coeff
        if i == 0:
            prefix = "-" if neg else ""
        else:
            prefix = " - " if neg else " + "

        paren_str = f"\\left({inner_str}\\right)" if tex else f"({inner_str})"
        if abs_c == 1:
            parts.append(f"{prefix}{paren_str}")
        else:
            c_str = frac_to_tex(abs_c) if tex else frac_to_raw(abs_c)
            parts.append(f"{prefix}{c_str}{paren_str}")
    return "".join(parts)


def _format_unmerged_tex(groups: list[BracketGroup]) -> str:
    """将各组去括号后直接拼接（不合并同类项），用于第 1 步解析。"""
    tokens: list[str] = []
    for g in groups:
        expanded = poly_mul({ZERO_KEY: g.coeff}, g.inner)
        # 保持组内标准项序
        for k, coeff in sorted(
            expanded.items(),
            key=lambda kv: (-sum(kv[0]), tuple(-e for e in kv[0])),
        ):
            vars_str = format_mono_vars(k, tex=True)
            neg = coeff < 0
            abs_c = -coeff if neg else coeff
            if not tokens:
                prefix = "-" if neg else ""
            else:
                prefix = " - " if neg else " + "
            if not vars_str:
                body = frac_to_tex(abs_c)
            elif abs_c == 1:
                body = vars_str
            else:
                body = f"{frac_to_tex(abs_c)}{vars_str}"
            tokens.append(f"{prefix}{body}")
    return "".join(tokens) if tokens else "0"


def _build_groups_for_level(
    level: int, use_frac: bool, rng: random.Random
) -> list[BracketGroup]:
    if level == 1:
        # 入门：仅 x，整数，结构为 (ax + b) ± (cx + d) 或 k(ax + b) + cx + d
        if rng.random() < 0.5:
            g1 = BracketGroup(Fraction(1), _make_inner_poly(rng, [K_X, K_CONST], False, -5, 5))
            c2 = rng.choice([Fraction(1), Fraction(-1)])
            g2 = BracketGroup(c2, _make_inner_poly(rng, [K_X, K_CONST], False, -5, 5))
            return [g1, g2]
        c1 = _rand_int(rng, -4, 4)
        g1 = BracketGroup(c1, _make_inner_poly(rng, [K_X, K_CONST], False, -5, 5))
        g2 = BracketGroup(Fraction(1), _make_inner_poly(rng, [K_X, K_CONST], False, -6, 6), is_paren=False)
        return [g1, g2]

    if level == 2:
        # 基础：仅 x（含一次与常数），25% 混入分数，两个括号组
        c1 = _rand_coeff(rng, use_frac, -5, 5)
        c2 = _rand_coeff(rng, use_frac, -5, 5)
        g1 = BracketGroup(c1, _make_inner_poly(rng, [K_X, K_CONST], use_frac, -6, 6))
        g2 = BracketGroup(c2, _make_inner_poly(rng, [K_X, K_CONST], use_frac, -6, 6))
        return [g1, g2]

    if level == 3:
        # 进阶：仅 x（含 x²、x、常数），40% 混入分数，2~3 组
        keys1 = rng.sample([K_X2, K_X, K_CONST], k=rng.choice([2, 3]))
        keys2 = rng.sample([K_X2, K_X, K_CONST], k=2)
        c1 = _rand_coeff(rng, use_frac, -5, 5)
        c2 = _rand_coeff(rng, use_frac, -5, 5)
        groups = [
            BracketGroup(c1, _make_inner_poly(rng, keys1, use_frac, -6, 6)),
            BracketGroup(c2, _make_inner_poly(rng, keys2, use_frac, -6, 6)),
        ]
        if rng.random() < 0.4:
            extra_key = rng.choice([K_X2, K_X])
            groups.append(
                BracketGroup(Fraction(1), {extra_key: _rand_coeff(rng, use_frac, -5, 5)}, is_paren=False)
            )
        return groups

    # level == 4: 挑战，x/y 双变量，考 xy、x²、y² 各算一类，50% 混入分数
    pool = [K_X2, K_XY, K_Y2, K_X, K_Y]
    chosen_base = rng.sample([K_X2, K_XY, K_Y2], k=2)
    keys1 = chosen_base + [rng.choice([K_X, K_Y, K_CONST])]
    keys2 = [chosen_base[0], rng.choice([K_XY, K_Y2, K_X, K_Y])]
    if len(set(keys2)) < 2:
        keys2 = [K_X2, K_XY]
    c1 = _rand_coeff(rng, use_frac, -4, 4)
    c2 = _rand_coeff(rng, use_frac, -4, 4)
    return [
        BracketGroup(c1, _make_inner_poly(rng, keys1, use_frac, -5, 5)),
        BracketGroup(c2, _make_inner_poly(rng, keys2, use_frac, -5, 5)),
    ]


def _make_hint(groups: list[BracketGroup], level: int, is_fraction: bool) -> str:
    hints: list[str] = []
    if any(g.is_paren and g.coeff < 0 for g in groups):
        hints.append("括号前有负号，去括号时里面每一项都要变号")
    else:
        hints.append("先把括号外的系数分别乘进括号里的每一项")
    if is_fraction:
        hints.append("分数系数合并同类项时先通分")
    if level == 4:
        hints.append("注意 x²、xy、y² 字母或次数不同，各自算一类，不能混在一起合并")
    return "；".join(hints) + "。"


def generate(level: int, rng: random.Random | None = None) -> Question:
    if level not in (1, 2, 3, 4):
        raise ValueError("难度必须在 1~4 之间")
    rng = rng or random.Random()
    want_frac = rng.random() < FRAC_PROB[level]

    groups: list[BracketGroup] = []
    for _ in range(40):
        cand = _build_groups_for_level(level, want_frac, rng)
        if want_frac and not _has_real_fraction(cand):
            # 强制把第一组外系数设为分数，保证分数标签名副其实
            cand[0] = BracketGroup(rng.choice(FRAC_POOL), cand[0].inner, cand[0].is_paren)
        # 确保结果不全消成 0（允许少量为 0，但主练习题尽量保留项）
        total: Poly = {}
        for g in cand:
            total = poly_add(total, poly_mul({ZERO_KEY: g.coeff}, g.inner))
        if total:
            groups = cand
            break
    else:
        groups = _build_groups_for_level(level, want_frac, rng)

    total_poly: Poly = {}
    for g in groups:
        total_poly = poly_add(total_poly, poly_mul({ZERO_KEY: g.coeff}, g.inner))
    total_poly = poly_clean(total_poly)

    is_frac = _has_real_fraction(groups)
    prompt_raw = _format_groups(groups, tex=False)
    prompt_tex = _format_groups(groups, tex=True)
    answer_raw = format_poly(total_poly, tex=False)
    answer_tex = format_poly(total_poly, tex=True)

    unmerged_tex = _format_unmerged_tex(groups)
    neg_note = "括号前为负号时，括号内各项记得变号。" if any(
        g.is_paren and g.coeff < 0 for g in groups
    ) else "按乘法分配律把括号展开。"

    steps = [
        Step(title="去括号", tex=unmerged_tex, note=neg_note),
        Step(
            title="合并同类项",
            tex=answer_tex,
            note="把相同字母且相同次数的项系数相加减。"
            + ("（x²、xy、y² 各自独立合并）" if level == 4 else ""),
        ),
    ]

    meta_groups = [
        {
            "coeff": frac_to_raw(g.coeff),
            "is_paren": g.is_paren,
            "terms": [
                [list(k), frac_to_raw(c)]
                for k, c in sorted(
                    g.inner.items(),
                    key=lambda kv: (-sum(kv[0]), tuple(-e for e in kv[0])),
                )
            ],
        }
        for g in groups
    ]

    return Question(
        topic="simplify",
        level=level,
        prompt_raw=prompt_raw,
        prompt_tex=prompt_tex,
        answer_raw=answer_raw,
        answer_tex=answer_tex,
        hint=_make_hint(groups, level, is_frac),
        steps=steps,
        is_fraction=is_frac,
        is_decimal=False,
        meta={"groups": meta_groups},
    )


def grade(
    question: Question,
    student_input: str,
    *,
    user_priors: dict[str, float] | None = None,
) -> GradeResult:
    raw = student_input.strip()
    if not raw:
        return GradeResult("error", False, "请先输入你的化简结果。")
    if "=" in raw:
        return GradeResult("error", False, "化简题只需填结果表达式，不需要写等号。")

    try:
        student_node = parse_expr(raw)
        student_poly = expand(student_node)
    except ParseError as exc:
        return GradeResult("error", False, f"格式有误：{exc}")

    student_tex = node_to_tex(student_node)
    expected_poly = expand(parse_expr(question.answer_raw))

    if student_poly != expected_poly:
        diag = diagnose_simplify(question, student_poly, user_priors=user_priors)
        return GradeResult(
            "wrong",
            False,
            "结果不对，再检查一下符号或系数。",
            student_tex=student_tex,
            diagnosis=diag,
        )

    if has_parentheses(student_node):
        return GradeResult(
            "parentheses",
            False,
            "结果等价，但还没有去括号，请继续化简。",
            student_tex=student_tex,
        )

    if has_unmerged_like_terms(student_node):
        return GradeResult(
            "unmerged",
            False,
            "结果等价，但还有同类项没合并完。",
            student_tex=student_tex,
        )

    return GradeResult("correct", True, "回答正确！", student_tex=student_tex)