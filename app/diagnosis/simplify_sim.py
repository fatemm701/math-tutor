from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
import math
import random
from typing import Any

from app.diagnosis.taxonomy import SIMPLIFY_BUG_CODES
from app.engines.expr_tree import (
    MonoKey,
    Poly,
    ZERO_KEY,
    format_mono_vars,
    format_poly,
    poly_add,
    poly_clean,
    poly_neg,
)
from app.engines.rational import frac_to_raw


@dataclass(frozen=True)
class SimplifyGroupData:
    coeff: Fraction
    is_paren: bool
    # 按题面展示顺序保留 (MonoKey, coeff)
    terms: tuple[tuple[MonoKey, Fraction], ...]


@dataclass(frozen=True)
class SimplifyBugCandidate:
    code: str
    poly: Poly
    detail: str


@dataclass(frozen=True)
class SimplifyAnalysis:
    groups: list[SimplifyGroupData]
    expected_poly: Poly
    is_fraction: bool
    has_neg_paren: bool
    has_coeff_paren: bool
    shared_keys: set[MonoKey]


def _key_name(k: MonoKey) -> str:
    s = format_mono_vars(k, tex=False)
    return s if s else "常数项"


def _fmt_group_short(g: SimplifyGroupData) -> str:
    inner = poly_clean({k: c for k, c in g.terms})
    inner_s = format_poly(inner, tex=False)
    if not g.is_paren:
        return inner_s
    if g.coeff == 1:
        return f"({inner_s})"
    if g.coeff == -1:
        return f"-({inner_s})"
    return f"{frac_to_raw(g.coeff)}({inner_s})"


def _poly_key(p: Poly) -> tuple[tuple[MonoKey, Fraction], ...]:
    return tuple(sorted(poly_clean(p).items()))


def analyze_simplify_meta(meta: dict[str, Any]) -> SimplifyAnalysis | None:
    if "groups" not in meta:
        return None
    groups: list[SimplifyGroupData] = []
    key_counts: dict[MonoKey, int] = {}
    expected: Poly = {}
    is_frac = False

    for gd in meta["groups"]:
        coeff = Fraction(gd["coeff"])
        if coeff.denominator != 1:
            is_frac = True
        is_paren = bool(gd.get("is_paren", True))
        terms_list: list[tuple[MonoKey, Fraction]] = []
        for k_raw, c_raw in gd["terms"]:
            k: MonoKey = (int(k_raw[0]), int(k_raw[1]), int(k_raw[2]), int(k_raw[3]))
            c = Fraction(c_raw)
            if c.denominator != 1:
                is_frac = True
            terms_list.append((k, c))
            key_counts[k] = key_counts.get(k, 0) + 1
            expected[k] = expected.get(k, Fraction(0)) + coeff * c
        groups.append(SimplifyGroupData(coeff=coeff, is_paren=is_paren, terms=tuple(terms_list)))

    expected = poly_clean(expected)
    has_neg_paren = any(g.is_paren and g.coeff < 0 and len(g.terms) >= 2 for g in groups)
    has_coeff_paren = any(g.is_paren and abs(g.coeff) != 1 and len(g.terms) >= 2 for g in groups)
    shared_keys = {k for k, cnt in key_counts.items() if cnt >= 2}

    return SimplifyAnalysis(
        groups=groups,
        expected_poly=expected,
        is_fraction=is_frac,
        has_neg_paren=has_neg_paren,
        has_coeff_paren=has_coeff_paren,
        shared_keys=shared_keys,
    )


def _add_cand(
    bucket: dict[str, list[SimplifyBugCandidate]],
    seen: dict[str, set[tuple[tuple[MonoKey, Fraction], ...]]],
    code: str,
    poly: Poly,
    expected_key: tuple[tuple[MonoKey, Fraction], ...],
    detail: str,
) -> None:
    cleaned = poly_clean(poly)
    pk = _poly_key(cleaned)
    if pk == expected_key or pk in seen[code]:
        return
    seen[code].add(pk)
    bucket[code].append(SimplifyBugCandidate(code=code, poly=cleaned, detail=detail))


def _eval_groups_normal(groups: list[SimplifyGroupData]) -> Poly:
    total: Poly = {}
    for g in groups:
        for k, c in g.terms:
            total[k] = total.get(k, Fraction(0)) + g.coeff * c
    return poly_clean(total)


def simulate_simplify_candidates(
    analysis: SimplifyAnalysis,
) -> dict[str, list[SimplifyBugCandidate]]:
    """对整式化简题正向模拟 7 类典型错因，返回候选错误多项式和中文诊断说明。"""
    bucket: dict[str, list[SimplifyBugCandidate]] = {c: [] for c in SIMPLIFY_BUG_CODES}
    seen: dict[str, set[tuple[tuple[MonoKey, Fraction], ...]]] = {c: set() for c in SIMPLIFY_BUG_CODES}
    expected = analysis.expected_poly
    expected_key = _poly_key(expected)
    groups = analysis.groups

    # ---- 1. simp_paren_sign: 负号去括号漏变号 ----
    neg_indices = [
        i for i, g in enumerate(groups) if g.is_paren and g.coeff < 0 and len(g.terms) >= 2
    ]
    for idx in neg_indices:
        g_bad = groups[idx]
        # 1a. 后面所有项都漏变号
        p_all: Poly = {}
        for i, g in enumerate(groups):
            for ti, (k, c) in enumerate(g.terms):
                eff = (-g.coeff * c) if (i == idx and ti >= 1) else (g.coeff * c)
                p_all[k] = p_all.get(k, Fraction(0)) + eff
        _add_cand(
            bucket, seen, "simp_paren_sign", p_all, expected_key,
            f"展开负号括号 {_fmt_group_short(g_bad)} 时，括号内后面的项可能忘记变号了。",
        )
        # 1b. 若括号内有 3 项，也模拟只漏变其中某一项
        if len(g_bad.terms) >= 3:
            for bad_ti in range(1, len(g_bad.terms)):
                p_one: Poly = {}
                for i, g in enumerate(groups):
                    for ti, (k, c) in enumerate(g.terms):
                        eff = (-g.coeff * c) if (i == idx and ti == bad_ti) else (g.coeff * c)
                        p_one[k] = p_one.get(k, Fraction(0)) + eff
                _add_cand(
                    bucket, seen, "simp_paren_sign", p_one, expected_key,
                    f"展开负号括号 {_fmt_group_short(g_bad)} 时，{_key_name(g_bad.terms[bad_ti][0])} 这一项可能漏变号了。",
                )

    if len(neg_indices) > 1:
        p_multi: Poly = {}
        for i, g in enumerate(groups):
            for ti, (k, c) in enumerate(g.terms):
                eff = (-g.coeff * c) if (i in neg_indices and ti >= 1) else (g.coeff * c)
                p_multi[k] = p_multi.get(k, Fraction(0)) + eff
        _add_cand(
            bucket, seen, "simp_paren_sign", p_multi, expected_key,
            "多个括号前有负号，去括号时括号内后面的项可能都忘记变号了。",
        )

    # ---- 2. simp_omit_mul: 分配律漏乘后项系数 ----
    coeff_indices = [
        i for i, g in enumerate(groups) if g.is_paren and abs(g.coeff) != 1 and len(g.terms) >= 2
    ]
    for idx in coeff_indices:
        g_bad = groups[idx]
        abs_c_str = frac_to_raw(abs(g_bad.coeff))
        for keep_sign in (True, False):
            p_omit: Poly = {}
            for i, g in enumerate(groups):
                for ti, (k, c) in enumerate(g.terms):
                    if i == idx and ti >= 1:
                        if keep_sign:
                            eff = (c if g.coeff > 0 else -c)
                        else:
                            eff = c
                    else:
                        eff = g.coeff * c
                    p_omit[k] = p_omit.get(k, Fraction(0)) + eff
            _add_cand(
                bucket, seen, "simp_omit_mul", p_omit, expected_key,
                f"展开 {_fmt_group_short(g_bad)} 时，括号外系数 {abs_c_str} 可能只乘了第一项，漏乘了后面的项。",
            )
        if len(g_bad.terms) >= 3:
            # 只漏乘最后一项
            last_ti = len(g_bad.terms) - 1
            for keep_sign in (True, False):
                p_last: Poly = {}
                for i, g in enumerate(groups):
                    for ti, (k, c) in enumerate(g.terms):
                        if i == idx and ti == last_ti:
                            eff = (c if g.coeff > 0 else -c) if keep_sign else c
                        else:
                            eff = g.coeff * c
                        p_last[k] = p_last.get(k, Fraction(0)) + eff
                _add_cand(
                    bucket, seen, "simp_omit_mul", p_last, expected_key,
                    f"展开 {_fmt_group_short(g_bad)} 时，括号外系数 {abs_c_str} 可能漏乘了最后的 {_key_name(g_bad.terms[last_ti][0])} 项。",
                )

    # ---- 3. simp_merge_op: 合并同类项加减符号错 ----
    # 收集每个共享键来自各组的贡献
    key_contribs: dict[MonoKey, list[Fraction]] = {}
    for g in groups:
        for k, c in g.terms:
            key_contribs.setdefault(k, []).append(g.coeff * c)

    for k in analysis.shared_keys:
        contribs = key_contribs.get(k, [])
        if len(contribs) < 2:
            continue
        # 翻转某一组对该同类项的贡献符号（例如 +3x 和 -2x 合并时算成了 +3x + 2x）
        for ci, val in enumerate(contribs):
            p_flip = dict(expected)
            p_flip[k] = p_flip.get(k, Fraction(0)) - 2 * val
            _add_cand(
                bucket, seen, "simp_merge_op", p_flip, expected_key,
                f"合并 {_key_name(k)} 同类项时，可能把加减符号算反了（记得带着每一项前面的符号相加减）。",
            )

    # ---- 4. simp_drop_term: 漏抄或误消某一项 ----
    if len(expected) >= 2:
        for k in list(expected.keys()):
            p_drop = {kk: vv for kk, vv in expected.items() if kk != k}
            _add_cand(
                bucket, seen, "simp_drop_term", p_drop, expected_key,
                f"最终结果里可能漏掉了 {_key_name(k)} 这一项，检查一下是不是漏抄或误消了。",
            )
    # 漏掉一整组裸项（如 L1/L3 末尾的裸项）
    for idx, g in enumerate(groups):
        if not g.is_paren and len(groups) >= 2:
            p_nog = _eval_groups_normal([gg for i, gg in enumerate(groups) if i != idx])
            _add_cand(
                bucket, seen, "simp_drop_term", p_nog, expected_key,
                f"化简时可能漏掉了括号外面的 {_fmt_group_short(g)}。",
            )

    # ---- 5. simp_mix_unlike: 误把非同类项合并在一起 ----
    exp_keys = sorted(expected.keys(), key=lambda kv: (-sum(kv), tuple(-e for e in kv)))
    if len(exp_keys) >= 2:
        for i in range(len(exp_keys)):
            for j in range(i + 1, len(exp_keys)):
                k1, k2 = exp_keys[i], exp_keys[j]
                c1, c2 = expected[k1], expected[k2]
                # 合并到 k1 或合并到 k2
                for target_k, drop_k in ((k1, k2), (k2, k1)):
                    p_mix = dict(expected)
                    p_mix[target_k] = c1 + c2
                    del p_mix[drop_k]
                    _add_cand(
                        bucket, seen, "simp_mix_unlike", p_mix, expected_key,
                        f"可能把非同类项 {_key_name(k1)} 与 {_key_name(k2)} 混在一起合并了，它们字母或次数不同，必须分开保留。",
                    )

    # ---- 6. simp_frac_add: 分数系数通分/分子分母直接相加错 ----
    if analysis.is_fraction:
        for k in analysis.shared_keys:
            contribs = key_contribs.get(k, [])
            if len(contribs) >= 2 and any(c.denominator > 1 for c in contribs):
                c1, c2 = contribs[0], contribs[1]
                rest = sum(contribs[2:], Fraction(0))
                # 6a. 分子分母直接相加: (n1 + n2) / (d1 + d2)
                d_sum = c1.denominator + c2.denominator
                if d_sum != 0:
                    bad_val = Fraction(c1.numerator + c2.numerator, d_sum) + rest
                    p_fa = dict(expected)
                    p_fa[k] = bad_val
                    _add_cand(
                        bucket, seen, "simp_frac_add", p_fa, expected_key,
                        f"合并 {_key_name(k)} 的分数系数时，不能把分子和分母直接相加，记得先通分。",
                    )
                # 6b. 取了公分母但分子忘记同步放大: (n1 + n2) / lcm(d1, d2)
                lcm_d = math.lcm(c1.denominator, c2.denominator)
                if c1.denominator != c2.denominator:
                    bad_val2 = Fraction(c1.numerator + c2.numerator, lcm_d) + rest
                    p_fb = dict(expected)
                    p_fb[k] = bad_val2
                    _add_cand(
                        bucket, seen, "simp_frac_add", p_fb, expected_key,
                        f"合并 {_key_name(k)} 的分数系数通分到分母 {lcm_d} 时，分子也要同乘对应倍数。",
                    )

    # ---- 7. simp_sign_all: 整体符号弄反 ----
    if expected:
        _add_cand(
            bucket, seen, "simp_sign_all", poly_neg(expected), expected_key,
            "各项系数大小都算对了，但整体正负号全弄反了。",
        )

    return bucket


def generate_synthetic_simplify_sample(
    analysis: SimplifyAnalysis,
    rng: random.Random,
    noisy_prob: float = 0.10,
    slip_prob: float = 0.16,
) -> tuple[Poly, str] | None:
    candidates = simulate_simplify_candidates(analysis)
    available = [c for c in SIMPLIFY_BUG_CODES if candidates[c]]
    exact_keys = {_poly_key(cand.poly) for cands in candidates.values() for cand in cands}
    expected_key = _poly_key(analysis.expected_poly)

    if not available or rng.random() < slip_prob:
        slip = _sample_simplify_slip(analysis, exact_keys, expected_key, rng)
        if slip is not None:
            return slip, "arithmetic_slip"

    if not available:
        return None

    weights_map = {
        "simp_paren_sign": 1.6,
        "simp_omit_mul": 1.5,
        "simp_merge_op": 1.4,
        "simp_drop_term": 1.1,
        "simp_mix_unlike": 1.3,
        "simp_frac_add": 1.4,
        "simp_sign_all": 1.0,
    }
    weights = [weights_map.get(c, 1.0) for c in available]
    chosen = rng.choices(available, weights=weights, k=1)[0]
    cand = rng.choice(candidates[chosen])

    # 少量带噪复合样本（如主错因 + 另一项系数差 ±1 或整体再反号）
    if rng.random() < noisy_prob and chosen != "simp_sign_all" and cand.poly:
        if rng.random() < 0.4:
            noisy = poly_neg(cand.poly)
        else:
            noisy = dict(cand.poly)
            k_pick = rng.choice(list(noisy.keys()))
            noisy[k_pick] = noisy[k_pick] + Fraction(rng.choice([-1, 1]))
            noisy = poly_clean(noisy)
        nk = _poly_key(noisy)
        if nk != expected_key and nk not in exact_keys:
            return noisy, chosen

    return cand.poly, chosen


def _sample_simplify_slip(
    analysis: SimplifyAnalysis,
    exact_keys: set[tuple[tuple[MonoKey, Fraction], ...]],
    expected_key: tuple[tuple[MonoKey, Fraction], ...],
    rng: random.Random,
) -> Poly | None:
    exp = analysis.expected_poly
    keys = list(exp.keys()) if exp else [ZERO_KEY]
    for _ in range(25):
        p = dict(exp)
        mode = rng.random()
        if mode < 0.55:
            # 随机 1~2 个项系数差 ±1, ±2, ±3
            n_mod = 1 if len(keys) == 1 or rng.random() < 0.6 else 2
            for k in rng.sample(keys, k=n_mod):
                delta = Fraction(rng.choice([-3, -2, -1, 1, 2, 3]))
                if analysis.is_fraction and rng.random() < 0.35:
                    delta = Fraction(rng.choice([-1, 1]), rng.choice([2, 3, 4]))
                p[k] = p.get(k, Fraction(0)) + delta
        elif mode < 0.80:
            # 多出一项随机系数或系数大幅算错
            k = rng.choice(keys)
            p[k] = Fraction(rng.randint(-12, 12))
        else:
            # 构造完全随机多项式
            p = {k: Fraction(rng.randint(-9, 9)) for k in keys}
        p = poly_clean(p)
        pk = _poly_key(p)
        if pk != expected_key and pk not in exact_keys:
            return p
    return None
