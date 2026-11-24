from __future__ import annotations

from fractions import Fraction
import math
from typing import Any

from app.diagnosis.equation_sim import (
    BugCandidate,
    EquationAnalysis,
    analyze_equation_meta,
    simulate_bug_candidates,
)
from app.diagnosis.taxonomy import EQUATION_BUG_CODES

_BIG_DIST = 10.0


def _build_feature_names() -> list[str]:
    names: list[str] = [
        # 题目结构特征
        "level",
        "has_denom",
        "has_non_frac_term",
        "has_paren",
        "has_neg_paren",
        "has_coeff_paren",
        "has_rhs_x",
        "has_lhs_const",
        "lcm",
        "total_a_abs",
        "total_a_is_neg",
        "total_a_is_one",
        "total_b_abs",
        "x0_is_frac",
        "x0_is_neg",
        "x0_is_zero",
        # 学生答案与正确答案的数学差分特征
        "stu_is_frac",
        "stu_is_int",
        "same_sign_x0",
        "is_opposite_x0",
        "is_reciprocal_x0",
        "log_abs_diff_x0",
        "rel_diff_x0",
        "diff_is_int_1_2",
        "stu_equals_total_b",
        "same_den_as_x0",
        "n_exact_bug_matches",
        "n_signflip_bug_matches",
        "min_any_bug_dist",
        "best_bug_margin",
    ]
    # 每类错因的候选数量、精确命中、反号命中、最小对数距离、相对距离
    for code in EQUATION_BUG_CODES:
        names.extend([
            f"avail_{code}",
            f"exact_{code}",
            f"flip_{code}",
            f"logdist_{code}",
            f"reldist_{code}",
        ])
    return names


FEATURE_NAMES: tuple[str, ...] = tuple(_build_feature_names())


def _safe_float(val: Fraction) -> float:
    return float(val.numerator) / float(val.denominator)


def _log_dist(a: Fraction, b: Fraction) -> float:
    diff = abs(_safe_float(a - b))
    return min(_BIG_DIST, math.log1p(diff))


def _rel_dist(student_x: Fraction, target: Fraction) -> float:
    diff = abs(_safe_float(student_x - target))
    denom = abs(_safe_float(target)) + 1.0
    return min(_BIG_DIST, diff / denom)


def extract_features_from_analysis(
    analysis: EquationAnalysis,
    level: int,
    student_x: Fraction,
    candidates: dict[str, list[BugCandidate]] | None = None,
) -> tuple[list[float], dict[str, list[BugCandidate]]]:
    """从结构化方程与学生错误数值提取固定顺序的浮点特征向量。"""
    if candidates is None:
        candidates = simulate_bug_candidates(analysis)

    x0 = analysis.true_x
    a = analysis.total_a
    b = analysis.total_b

    diff_x0 = abs(student_x - x0)
    same_sign = 1.0 if ((student_x > 0 and x0 > 0) or (student_x < 0 and x0 < 0)) else 0.0
    is_opposite = 1.0 if (x0 != 0 and student_x == -x0) else 0.0
    is_recip = 1.0 if (x0 != 0 and student_x * x0 == 1) else 0.0
    diff_small_int = 1.0 if (diff_x0.denominator == 1 and diff_x0 in (1, 2)) else 0.0
    stu_eq_b = 1.0 if (a != 1 and student_x == b) else 0.0
    same_den = 1.0 if (student_x.denominator == x0.denominator) else 0.0

    # 先计算各类错因的匹配与距离统计
    per_bug_feats: list[float] = []
    n_exact = 0
    n_flip = 0
    bug_min_dists: list[float] = []

    for code in EQUATION_BUG_CODES:
        cands = candidates[code]
        avail = 1.0 if cands else 0.0
        exact = 0.0
        flip = 0.0
        min_ld = _BIG_DIST
        min_rd = _BIG_DIST

        for c in cands:
            if student_x == c.value:
                exact = 1.0
            if c.value != 0 and student_x == -c.value:
                flip = 1.0
            ld = _log_dist(student_x, c.value)
            if ld < min_ld:
                min_ld = ld
                min_rd = _rel_dist(student_x, c.value)

        if exact > 0:
            n_exact += 1
        if flip > 0:
            n_flip += 1
        if cands:
            bug_min_dists.append(min_ld)

        per_bug_feats.extend([avail, exact, flip, min_ld, min_rd])

    sorted_dists = sorted(bug_min_dists)
    min_any_dist = sorted_dists[0] if sorted_dists else _BIG_DIST
    second_dist = sorted_dists[1] if len(sorted_dists) > 1 else _BIG_DIST
    best_margin = second_dist - min_any_dist

    base_feats: list[float] = [
        float(level),
        1.0 if analysis.has_denom else 0.0,
        1.0 if analysis.has_non_frac_term else 0.0,
        1.0 if analysis.has_paren else 0.0,
        1.0 if analysis.has_neg_paren else 0.0,
        1.0 if analysis.has_coeff_paren else 0.0,
        1.0 if analysis.has_rhs_x else 0.0,
        1.0 if analysis.has_lhs_const else 0.0,
        float(analysis.lcm),
        min(50.0, abs(_safe_float(a))),
        1.0 if a < 0 else 0.0,
        1.0 if abs(a) == 1 else 0.0,
        min(100.0, abs(_safe_float(b))),
        1.0 if x0.denominator > 1 else 0.0,
        1.0 if x0 < 0 else 0.0,
        1.0 if x0 == 0 else 0.0,
        1.0 if student_x.denominator > 1 else 0.0,
        1.0 if student_x.denominator == 1 else 0.0,
        same_sign,
        is_opposite,
        is_recip,
        _log_dist(student_x, x0),
        _rel_dist(student_x, x0),
        diff_small_int,
        stu_eq_b,
        same_den,
        float(n_exact),
        float(n_flip),
        min_any_dist,
        best_margin,
    ]

    return base_feats + per_bug_feats, candidates


def extract_features_from_meta(
    meta: dict[str, Any],
    level: int,
    student_x: Fraction,
) -> tuple[list[float], dict[str, list[BugCandidate]], EquationAnalysis] | None:
    analysis = analyze_equation_meta(meta)
    if analysis is None:
        return None
    feats, candidates = extract_features_from_analysis(analysis, level, student_x)
    return feats, candidates, analysis
