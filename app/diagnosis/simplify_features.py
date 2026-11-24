from __future__ import annotations

from fractions import Fraction
import math
from typing import Any

from app.diagnosis.simplify_sim import (
    SimplifyAnalysis,
    SimplifyBugCandidate,
    analyze_simplify_meta,
    simulate_simplify_candidates,
)
from app.diagnosis.taxonomy import SIMPLIFY_BUG_CODES
from app.engines.expr_tree import Poly, ZERO_KEY, poly_clean, poly_neg

_BIG_DIST = 10.0


def _build_simplify_feature_names() -> list[str]:
    names: list[str] = [
        # 题目结构特征
        "level",
        "is_fraction",
        "n_groups",
        "has_neg_paren",
        "has_coeff_paren",
        "n_expected_terms",
        "n_shared_keys",
        "has_const_expected",
        "has_deg2_expected",
        # 学生多项式 vs 标准多项式差分特征
        "n_student_terms",
        "term_count_diff",
        "n_missing_keys",
        "n_extra_keys",
        "n_coeff_mismatch",
        "n_exact_match_keys",
        "exact_same_keys",
        "is_negation_all",
        "sum_coeff_same",
        "key_jaccard_expected",
        "poly_l1_logdist",
        "poly_max_coeff_logdist",
        "single_key_diff_only",
        "student_is_zero",
        "n_exact_bug_matches",
        "n_neg_bug_matches",
        "min_any_bug_dist",
        "best_bug_margin",
    ]
    for code in SIMPLIFY_BUG_CODES:
        names.extend([
            f"avail_{code}",
            f"exact_{code}",
            f"neg_{code}",
            f"logdist_{code}",
            f"jaccard_{code}",
        ])
    return names


SIMPLIFY_FEATURE_NAMES: tuple[str, ...] = tuple(_build_simplify_feature_names())


def _safe_float(val: Fraction) -> float:
    return float(val.numerator) / float(val.denominator)


def _poly_l1_logdist(p1: Poly, p2: Poly) -> float:
    keys = set(p1.keys()) | set(p2.keys())
    total = 0.0
    for k in keys:
        total += abs(_safe_float(p1.get(k, Fraction(0)) - p2.get(k, Fraction(0))))
    return min(_BIG_DIST, math.log1p(total))


def _poly_max_logdist(p1: Poly, p2: Poly) -> float:
    keys = set(p1.keys()) | set(p2.keys())
    if not keys:
        return 0.0
    m = max(abs(_safe_float(p1.get(k, Fraction(0)) - p2.get(k, Fraction(0)))) for k in keys)
    return min(_BIG_DIST, math.log1p(m))


def _key_jaccard(p1: Poly, p2: Poly) -> float:
    k1, k2 = set(p1.keys()), set(p2.keys())
    union = k1 | k2
    if not union:
        return 1.0
    return len(k1 & k2) / len(union)


def extract_simplify_features_from_analysis(
    analysis: SimplifyAnalysis,
    level: int,
    student_poly: Poly,
    candidates: dict[str, list[SimplifyBugCandidate]] | None = None,
) -> tuple[list[float], dict[str, list[SimplifyBugCandidate]]]:
    student_poly = poly_clean(student_poly)
    if candidates is None:
        candidates = simulate_simplify_candidates(analysis)

    exp = analysis.expected_poly
    exp_keys = set(exp.keys())
    stu_keys = set(student_poly.keys())
    all_keys = exp_keys | stu_keys

    missing = len(exp_keys - stu_keys)
    extra = len(stu_keys - exp_keys)
    mismatch = sum(1 for k in all_keys if student_poly.get(k, Fraction(0)) != exp.get(k, Fraction(0)))
    exact_match_keys = sum(1 for k in exp_keys & stu_keys if student_poly[k] == exp[k])

    neg_stu = poly_neg(student_poly)
    is_neg_all = 1.0 if (exp and student_poly == poly_neg(exp)) else 0.0
    sum_same = 1.0 if (sum(student_poly.values(), Fraction(0)) == sum(exp.values(), Fraction(0))) else 0.0

    per_bug_feats: list[float] = []
    n_exact = 0
    n_neg = 0
    bug_min_dists: list[float] = []

    for code in SIMPLIFY_BUG_CODES:
        cands = candidates[code]
        avail = 1.0 if cands else 0.0
        exact = 0.0
        neg_hit = 0.0
        min_ld = _BIG_DIST
        best_jacc = 0.0

        for c in cands:
            if student_poly == c.poly:
                exact = 1.0
            if c.poly and neg_stu == c.poly:
                neg_hit = 1.0
            ld = _poly_l1_logdist(student_poly, c.poly)
            if ld < min_ld:
                min_ld = ld
                best_jacc = _key_jaccard(student_poly, c.poly)

        if exact > 0:
            n_exact += 1
        if neg_hit > 0:
            n_neg += 1
        if cands:
            bug_min_dists.append(min_ld)

        per_bug_feats.extend([avail, exact, neg_hit, min_ld, best_jacc])

    sorted_dists = sorted(bug_min_dists)
    min_any_dist = sorted_dists[0] if sorted_dists else _BIG_DIST
    second_dist = sorted_dists[1] if len(sorted_dists) > 1 else _BIG_DIST
    best_margin = second_dist - min_any_dist

    base_feats: list[float] = [
        float(level),
        1.0 if analysis.is_fraction else 0.0,
        float(len(analysis.groups)),
        1.0 if analysis.has_neg_paren else 0.0,
        1.0 if analysis.has_coeff_paren else 0.0,
        float(len(exp)),
        float(len(analysis.shared_keys)),
        1.0 if ZERO_KEY in exp else 0.0,
        1.0 if any(sum(k) >= 2 for k in exp) else 0.0,
        float(len(student_poly)),
        float(len(student_poly) - len(exp)),
        float(missing),
        float(extra),
        float(mismatch),
        float(exact_match_keys),
        1.0 if exp_keys == stu_keys else 0.0,
        is_neg_all,
        sum_same,
        _key_jaccard(student_poly, exp),
        _poly_l1_logdist(student_poly, exp),
        _poly_max_logdist(student_poly, exp),
        1.0 if mismatch == 1 else 0.0,
        1.0 if not student_poly else 0.0,
        float(n_exact),
        float(n_neg),
        min_any_dist,
        best_margin,
    ]

    return base_feats + per_bug_feats, candidates


def extract_simplify_features_from_meta(
    meta: dict[str, Any],
    level: int,
    student_poly: Poly,
) -> tuple[list[float], dict[str, list[SimplifyBugCandidate]], SimplifyAnalysis] | None:
    analysis = analyze_simplify_meta(meta)
    if analysis is None:
        return None
    feats, candidates = extract_simplify_features_from_analysis(analysis, level, student_poly)
    return feats, candidates, analysis
