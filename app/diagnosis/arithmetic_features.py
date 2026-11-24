from __future__ import annotations

from fractions import Fraction
import math
from typing import Any

from app.diagnosis.arithmetic_sim import (
    ARITHMETIC_KINDS,
    ArithmeticAnalysis,
    ArithmeticBugCandidate,
    analyze_arithmetic_meta,
    simulate_arithmetic_candidates,
)
from app.diagnosis.taxonomy import ARITHMETIC_BUG_CODES

_BIG_DIST = 10.0


def _build_arithmetic_feature_names() -> list[str]:
    names: list[str] = [
        "level",
        "is_decimal",
        "is_fraction",
        # one-hot 小题型
        *[f"kind_{k}" for k in ARITHMETIC_KINDS],
        # 数值差分特征
        "exp_is_neg",
        "exp_is_zero",
        "exp_is_frac",
        "stu_is_neg",
        "stu_is_frac",
        "same_sign_exp",
        "is_opposite_exp",
        "is_reciprocal_exp",
        "ratio_is_pow10",
        "diff_is_int_1",
        "same_den_as_exp",
        "log_abs_diff_exp",
        "rel_diff_exp",
        "n_exact_bug_matches",
        "n_flip_bug_matches",
        "min_any_bug_dist",
        "best_bug_margin",
    ]
    for code in ARITHMETIC_BUG_CODES:
        names.extend([
            f"avail_{code}",
            f"exact_{code}",
            f"flip_{code}",
            f"logdist_{code}",
            f"reldist_{code}",
        ])
    return names


ARITHMETIC_FEATURE_NAMES: tuple[str, ...] = tuple(_build_arithmetic_feature_names())


def _safe_float(val: Fraction) -> float:
    return float(val.numerator) / float(val.denominator)


def _log_dist(a: Fraction, b: Fraction) -> float:
    return min(_BIG_DIST, math.log1p(abs(_safe_float(a - b))))


def _rel_dist(student_val: Fraction, target: Fraction) -> float:
    diff = abs(_safe_float(student_val - target))
    denom = abs(_safe_float(target)) + 1.0
    return min(_BIG_DIST, diff / denom)


def extract_arithmetic_features_from_analysis(
    analysis: ArithmeticAnalysis,
    level: int,
    student_val: Fraction,
    candidates: dict[str, list[ArithmeticBugCandidate]] | None = None,
) -> tuple[list[float], dict[str, list[ArithmeticBugCandidate]]]:
    if candidates is None:
        candidates = simulate_arithmetic_candidates(analysis)

    exp = analysis.expected
    same_sign = 1.0 if ((student_val > 0 and exp > 0) or (student_val < 0 and exp < 0)) else 0.0
    is_opp = 1.0 if (exp != 0 and student_val == -exp) else 0.0
    is_recip = 1.0 if (exp != 0 and student_val * exp == 1) else 0.0
    ratio_pow10 = 0.0
    if exp != 0 and student_val != 0:
        ratio = abs(student_val / exp)
        if ratio in (Fraction(10), Fraction(1, 10), Fraction(100), Fraction(1, 100)):
            ratio_pow10 = 1.0
    diff_is_1 = 1.0 if abs(student_val - exp) == 1 else 0.0
    same_den = 1.0 if student_val.denominator == exp.denominator else 0.0

    per_bug_feats: list[float] = []
    n_exact = 0
    n_flip = 0
    bug_min_dists: list[float] = []

    for code in ARITHMETIC_BUG_CODES:
        cands = candidates[code]
        avail = 1.0 if cands else 0.0
        exact = 0.0
        flip = 0.0
        min_ld = _BIG_DIST
        min_rd = _BIG_DIST

        for c in cands:
            if student_val == c.value:
                exact = 1.0
            if c.value != 0 and student_val == -c.value:
                flip = 1.0
            ld = _log_dist(student_val, c.value)
            if ld < min_ld:
                min_ld = ld
                min_rd = _rel_dist(student_val, c.value)

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

    kind_onehot = [1.0 if analysis.kind == k else 0.0 for k in ARITHMETIC_KINDS]

    base_feats: list[float] = [
        float(level),
        1.0 if analysis.is_decimal else 0.0,
        1.0 if analysis.is_fraction else 0.0,
        *kind_onehot,
        1.0 if exp < 0 else 0.0,
        1.0 if exp == 0 else 0.0,
        1.0 if exp.denominator > 1 else 0.0,
        1.0 if student_val < 0 else 0.0,
        1.0 if student_val.denominator > 1 else 0.0,
        same_sign,
        is_opp,
        is_recip,
        ratio_pow10,
        diff_is_1,
        same_den,
        _log_dist(student_val, exp),
        _rel_dist(student_val, exp),
        float(n_exact),
        float(n_flip),
        min_any_dist,
        best_margin,
    ]

    return base_feats + per_bug_feats, candidates


def extract_arithmetic_features_from_meta(
    meta: dict[str, Any],
    level: int,
    student_val: Fraction,
) -> tuple[list[float], dict[str, list[ArithmeticBugCandidate]], ArithmeticAnalysis] | None:
    analysis = analyze_arithmetic_meta(meta)
    if analysis is None:
        return None
    feats, candidates = extract_arithmetic_features_from_analysis(analysis, level, student_val)
    return feats, candidates, analysis
