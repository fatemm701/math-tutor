from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
import math
import random
from typing import Any

from app.diagnosis.taxonomy import EQUATION_BUG_CODES


@dataclass(frozen=True)
class TermData:
    outer: int
    inner_x: int
    inner_c: int
    den: int = 1
    is_paren: bool = False

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "TermData":
        return cls(
            outer=int(d["outer"]),
            inner_x=int(d["inner_x"]),
            inner_c=int(d["inner_c"]),
            den=int(d.get("den", 1)),
            is_paren=bool(d.get("is_paren", False)),
        )


@dataclass(frozen=True)
class BugCandidate:
    code: str
    value: Fraction
    detail: str


@dataclass(frozen=True)
class EquationAnalysis:
    lhs: list[TermData]
    rhs: list[TermData]
    lcm: int
    true_x: Fraction
    after_lcm_lhs: list[TermData]
    after_lcm_rhs: list[TermData]
    total_a: Fraction
    total_b: Fraction
    has_denom: bool
    has_non_frac_term: bool
    has_paren: bool
    has_neg_paren: bool
    has_coeff_paren: bool
    has_rhs_x: bool
    has_lhs_const: bool


def _fmt_linear_short(a: int, b: int) -> str:
    parts: list[str] = []
    if a != 0:
        parts.append("x" if a == 1 else ("-x" if a == -1 else f"{a}x"))
    if b != 0:
        if not parts:
            parts.append(str(b))
        elif b > 0:
            parts.append(f" + {b}")
        else:
            parts.append(f" - {-b}")
    return "".join(parts) if parts else "0"


def _fmt_term_short(t: TermData) -> str:
    inner = _fmt_linear_short(t.inner_x, t.inner_c)
    if t.inner_x != 0 and t.inner_c != 0:
        if t.outer == 1:
            return f"({inner})"
        if t.outer == -1:
            return f"-({inner})"
        return f"{t.outer}({inner})"
    return _fmt_linear_short(t.outer * t.inner_x, t.outer * t.inner_c)


def _solve_linear(lhs_x: Fraction, lhs_c: Fraction, rhs_x: Fraction, rhs_c: Fraction) -> Fraction | None:
    a = lhs_x - rhs_x
    if a == 0:
        return None
    b = rhs_c - lhs_c
    return b / a


def _mul_lcm_terms(terms: list[TermData], lcm_val: int) -> list[TermData]:
    if lcm_val <= 1:
        return list(terms)
    out: list[TermData] = []
    for t in terms:
        factor = lcm_val // t.den
        new_outer = t.outer * factor
        is_paren = (t.inner_x != 0 and t.inner_c != 0) and (
            t.is_paren or abs(new_outer) != 1 or new_outer < 0
        )
        out.append(TermData(new_outer, t.inner_x, t.inner_c, den=1, is_paren=is_paren))
    return out


def _expand_side_exact(terms: list[TermData]) -> tuple[Fraction, Fraction]:
    ax = Fraction(0)
    cc = Fraction(0)
    for t in terms:
        k = Fraction(t.outer, t.den)
        ax += k * t.inner_x
        cc += k * t.inner_c
    return ax, cc


def analyze_equation_meta(meta: dict[str, Any]) -> EquationAnalysis | None:
    """从 Question.meta 解析结构化方程信息；若 meta 不含 lhs/rhs 则返回 None。"""
    if "lhs" not in meta or "rhs" not in meta or "solution" not in meta:
        return None
    lhs = [TermData.from_dict(t) for t in meta["lhs"]]
    rhs = [TermData.from_dict(t) for t in meta["rhs"]]
    dens = [t.den for t in lhs + rhs if t.den > 1]
    lcm_val = int(meta.get("lcm") or (math.lcm(*dens) if dens else 1))
    true_x = Fraction(meta["solution"])

    after_lhs = _mul_lcm_terms(lhs, lcm_val)
    after_rhs = _mul_lcm_terms(rhs, lcm_val)

    lx, lc = _expand_side_exact(after_lhs)
    rx, rc = _expand_side_exact(after_rhs)
    total_a = lx - rx
    total_b = rc - lc

    all_after = after_lhs + after_rhs
    has_denom = lcm_val > 1
    has_non_frac_term = has_denom and any(t.den == 1 and (t.inner_x != 0 or t.inner_c != 0) and t.outer != 0 for t in lhs + rhs)
    has_paren = any(t.inner_x != 0 and t.inner_c != 0 for t in all_after)
    has_neg_paren = any(t.outer < 0 and t.inner_x != 0 and t.inner_c != 0 for t in all_after)
    has_coeff_paren = any(abs(t.outer) > 1 and t.inner_x != 0 and t.inner_c != 0 for t in all_after)
    has_rhs_x = any(t.inner_x != 0 and t.outer != 0 for t in after_rhs)
    has_lhs_const = any(t.inner_c != 0 and t.outer != 0 for t in after_lhs)

    return EquationAnalysis(
        lhs=lhs,
        rhs=rhs,
        lcm=lcm_val,
        true_x=true_x,
        after_lcm_lhs=after_lhs,
        after_lcm_rhs=after_rhs,
        total_a=total_a,
        total_b=total_b,
        has_denom=has_denom,
        has_non_frac_term=has_non_frac_term,
        has_paren=has_paren,
        has_neg_paren=has_neg_paren,
        has_coeff_paren=has_coeff_paren,
        has_rhs_x=has_rhs_x,
        has_lhs_const=has_lhs_const,
    )


def _add_candidate(
    bucket: dict[str, list[BugCandidate]],
    seen: dict[str, set[Fraction]],
    code: str,
    val: Fraction | None,
    true_x: Fraction,
    detail: str,
) -> None:
    if val is None or val == true_x:
        return
    if val in seen[code]:
        return
    seen[code].add(val)
    bucket[code].append(BugCandidate(code=code, value=val, detail=detail))


def simulate_bug_candidates(analysis: EquationAnalysis) -> dict[str, list[BugCandidate]]:
    """
    对给定一元一次方程，正向模拟 8 类初中典型错因，返回每类错因对应的候选错误解和中文诊断说明。
    """
    bucket: dict[str, list[BugCandidate]] = {c: [] for c in EQUATION_BUG_CODES}
    seen: dict[str, set[Fraction]] = {c: set() for c in EQUATION_BUG_CODES}
    true_x = analysis.true_x
    lcm_val = analysis.lcm

    # ---- 1. denom_omit_const: 去分母漏乘不含分母的整数项/常数项 ----
    if analysis.has_denom and analysis.has_non_frac_term:
        def _mul_skip_int(terms: list[TermData], skip_idx: int | None = None) -> tuple[Fraction, Fraction]:
            ax, cc = Fraction(0), Fraction(0)
            for idx, t in enumerate(terms):
                if t.den > 1:
                    factor = lcm_val // t.den
                elif skip_idx is None or idx == skip_idx:
                    factor = 1  # 漏乘 lcm
                else:
                    factor = lcm_val
                ax += Fraction(t.outer * factor * t.inner_x)
                cc += Fraction(t.outer * factor * t.inner_c)
            return ax, cc

        # 所有无分母项都漏乘 lcm
        lx, lc = _mul_skip_int(analysis.lhs, None)
        rx, rc = _mul_skip_int(analysis.rhs, None)
        _add_candidate(
            bucket, seen, "denom_omit_const",
            _solve_linear(lx, lc, rx, rc), true_x,
            f"去分母时方程两边都要同乘 {lcm_val}，可能漏乘了不含分母的整数/常数项。",
        )

        # 逐个无分母项漏乘（L4 两侧各有整数项时特别常见）
        for i, t in enumerate(analysis.lhs):
            if t.den == 1 and t.outer != 0:
                lx2, lc2 = _mul_skip_int(analysis.lhs, i)
                rx2, rc2 = _expand_side_exact(analysis.after_lcm_rhs)
                _add_candidate(
                    bucket, seen, "denom_omit_const",
                    _solve_linear(lx2, lc2, rx2, rc2), true_x,
                    f"去分母同乘 {lcm_val} 时，方程左边的整数项 {_fmt_term_short(t)} 可能漏乘了 {lcm_val}。",
                )
        for i, t in enumerate(analysis.rhs):
            if t.den == 1 and t.outer != 0:
                lx2, lc2 = _expand_side_exact(analysis.after_lcm_lhs)
                rx2, rc2 = _mul_skip_int(analysis.rhs, i)
                _add_candidate(
                    bucket, seen, "denom_omit_const",
                    _solve_linear(lx2, lc2, rx2, rc2), true_x,
                    f"去分母同乘 {lcm_val} 时，方程右边的整数项 {_fmt_term_short(t)} 可能漏乘了 {lcm_val}。",
                )

    # ---- 2. denom_mul_error: 去分母倍数算错 ----
    if analysis.has_denom:
        # 2a. 直接把分母去掉（分子不乘倍数，整数项也不乘）
        lx = sum((Fraction(t.outer * t.inner_x) for t in analysis.lhs), Fraction(0))
        lc = sum((Fraction(t.outer * t.inner_c) for t in analysis.lhs), Fraction(0))
        rx = sum((Fraction(t.outer * t.inner_x) for t in analysis.rhs), Fraction(0))
        rc = sum((Fraction(t.outer * t.inner_c) for t in analysis.rhs), Fraction(0))
        _add_candidate(
            bucket, seen, "denom_mul_error",
            _solve_linear(lx, lc, rx, rc), true_x,
            f"去分母不能直接把分母擦掉，各分式分子都要乘「{lcm_val} ÷ 各自的分母」。",
        )

        # 2b. 分式直接去分母（倍数取 1），整数项乘了 lcm
        def _drop_frac_keep_int(terms: list[TermData]) -> tuple[Fraction, Fraction]:
            ax, cc = Fraction(0), Fraction(0)
            for t in terms:
                factor = 1 if t.den > 1 else lcm_val
                ax += Fraction(t.outer * factor * t.inner_x)
                cc += Fraction(t.outer * factor * t.inner_c)
            return ax, cc

        lx2, lc2 = _drop_frac_keep_int(analysis.lhs)
        rx2, rc2 = _drop_frac_keep_int(analysis.rhs)
        _add_candidate(
            bucket, seen, "denom_mul_error",
            _solve_linear(lx2, lc2, rx2, rc2), true_x,
            f"去分母时分式的分子漏乘了对应倍数（应乘 {lcm_val} ÷ 原分母）。",
        )

        # 2c. 两个分式乘的倍数弄反（如分母 2 和 3，分别错乘了 2 和 3 而不是 3 和 2）
        frac_terms = [(side_i, idx, t) for side_i, side in enumerate((analysis.lhs, analysis.rhs))
                      for idx, t in enumerate(side) if t.den > 1]
        if len(frac_terms) == 2 and frac_terms[0][2].den != frac_terms[1][2].den:
            swapped_factors = {
                (frac_terms[0][0], frac_terms[0][1]): lcm_val // frac_terms[1][2].den,
                (frac_terms[1][0], frac_terms[1][1]): lcm_val // frac_terms[0][2].den,
            }

            def _eval_swapped(side_i: int, terms: list[TermData]) -> tuple[Fraction, Fraction]:
                ax, cc = Fraction(0), Fraction(0)
                for idx, t in enumerate(terms):
                    factor = swapped_factors.get((side_i, idx), lcm_val // t.den)
                    ax += Fraction(t.outer * factor * t.inner_x)
                    cc += Fraction(t.outer * factor * t.inner_c)
                return ax, cc

            lx3, lc3 = _eval_swapped(0, analysis.lhs)
            rx3, rc3 = _eval_swapped(1, analysis.rhs)
            _add_candidate(
                bucket, seen, "denom_mul_error",
                _solve_linear(lx3, lc3, rx3, rc3), true_x,
                f"去分母同乘 {lcm_val} 时，可能把两个分式各自的倍数乘反了。",
            )

        # 2d. 某分式错乘了自身分母或错乘了完整 lcm 而未约分母
        for side_i, idx, t in frac_terms:
            def _eval_wrong_one(s_i: int, terms: list[TermData], bad_factor: int) -> tuple[Fraction, Fraction]:
                ax, cc = Fraction(0), Fraction(0)
                for j, tm in enumerate(terms):
                    factor = bad_factor if (s_i == side_i and j == idx) else (lcm_val // tm.den)
                    ax += Fraction(tm.outer * factor * tm.inner_x)
                    cc += Fraction(tm.outer * factor * tm.inner_c)
                return ax, cc

            for bad_f in (t.den, lcm_val):
                if bad_f != lcm_val // t.den:
                    lx4, lc4 = _eval_wrong_one(0, analysis.lhs, bad_f)
                    rx4, rc4 = _eval_wrong_one(1, analysis.rhs, bad_f)
                    _add_candidate(
                        bucket, seen, "denom_mul_error",
                        _solve_linear(lx4, lc4, rx4, rc4), true_x,
                        f"去分母同乘 {lcm_val} 时，分母为 {t.den} 的项应乘 {lcm_val // t.den}，可能乘错了倍数。",
                    )

    # ---- 3. paren_sign: 负号去括号漏变号（括号内第二项没变号） ----
    if analysis.has_neg_paren:
        neg_targets = [
            (side_i, idx, t)
            for side_i, side in enumerate((analysis.after_lcm_lhs, analysis.after_lcm_rhs))
            for idx, t in enumerate(side)
            if t.outer < 0 and t.inner_x != 0 and t.inner_c != 0
        ]

        def _eval_paren_sign(bad_set: set[tuple[int, int]]) -> Fraction | None:
            res = []
            for side_i, side in enumerate((analysis.after_lcm_lhs, analysis.after_lcm_rhs)):
                ax, cc = Fraction(0), Fraction(0)
                for idx, t in enumerate(side):
                    ax += Fraction(t.outer * t.inner_x)
                    if (side_i, idx) in bad_set:
                        # 负号漏分配给第二项：符号取反（原本 outer*inner_c，误算成 -outer*inner_c）
                        cc += Fraction(-t.outer * t.inner_c)
                    else:
                        cc += Fraction(t.outer * t.inner_c)
                res.append((ax, cc))
            return _solve_linear(res[0][0], res[0][1], res[1][0], res[1][1])

        for side_i, idx, t in neg_targets:
            _add_candidate(
                bucket, seen, "paren_sign",
                _eval_paren_sign({(side_i, idx)}), true_x,
                f"展开负号括号 {_fmt_term_short(t)} 时，括号里的常数项可能忘记变号了。",
            )
        if len(neg_targets) > 1:
            _add_candidate(
                bucket, seen, "paren_sign",
                _eval_paren_sign({(s, i) for s, i, _ in neg_targets}), true_x,
                "多个括号前有负号，去括号时括号里的常数项可能忘记变号了。",
            )

    # ---- 4. paren_omit_mul: 去括号漏乘括号内后项系数 ----
    if analysis.has_coeff_paren:
        coeff_targets = [
            (side_i, idx, t)
            for side_i, side in enumerate((analysis.after_lcm_lhs, analysis.after_lcm_rhs))
            for idx, t in enumerate(side)
            if abs(t.outer) > 1 and t.inner_x != 0 and t.inner_c != 0
        ]

        def _eval_paren_omit(bad_set: set[tuple[int, int]], keep_outer_sign: bool) -> Fraction | None:
            res = []
            for side_i, side in enumerate((analysis.after_lcm_lhs, analysis.after_lcm_rhs)):
                ax, cc = Fraction(0), Fraction(0)
                for idx, t in enumerate(side):
                    ax += Fraction(t.outer * t.inner_x)
                    if (side_i, idx) in bad_set:
                        if keep_outer_sign:
                            sign = 1 if t.outer > 0 else -1
                            cc += Fraction(sign * t.inner_c)
                        else:
                            cc += Fraction(t.inner_c)
                    else:
                        cc += Fraction(t.outer * t.inner_c)
                res.append((ax, cc))
            return _solve_linear(res[0][0], res[0][1], res[1][0], res[1][1])

        for side_i, idx, t in coeff_targets:
            for keep_sign in (True, False):
                _add_candidate(
                    bucket, seen, "paren_omit_mul",
                    _eval_paren_omit({(side_i, idx)}, keep_sign), true_x,
                    f"展开 {_fmt_term_short(t)} 时，括号外的系数 {abs(t.outer)} 可能只乘了 x 项，漏乘了后面的常数项。",
                )
        if len(coeff_targets) > 1:
            for keep_sign in (True, False):
                _add_candidate(
                    bucket, seen, "paren_omit_mul",
                    _eval_paren_omit({(s, i) for s, i, _ in coeff_targets}, keep_sign), true_x,
                    "用乘法分配律去括号时，括号外系数可能漏乘了括号里的常数项。",
                )

    # ---- 5. transpose_sign: 移项忘记变号 ----
    lx, lc = _expand_side_exact(analysis.after_lcm_lhs)
    rx, rc = _expand_side_exact(analysis.after_lcm_rhs)

    # 5a. 左边常数项移到右边忘变号: total_b = rc + lc
    if lc != 0:
        _add_candidate(
            bucket, seen, "transpose_sign",
            _solve_linear(lx, -lc, rx, rc), true_x,
            "把常数项从等号左边移到右边时，可能忘记变号了。",
        )
    # 5b. 右边 x 项移到左边忘变号: total_a = lx + rx
    if rx != 0:
        _add_candidate(
            bucket, seen, "transpose_sign",
            _solve_linear(lx, lc, -rx, rc), true_x,
            "把含 x 的项从等号右边移到左边时，可能忘记变号了。",
        )
    # 5c. 两边移项都忘变号
    if lc != 0 and rx != 0:
        _add_candidate(
            bucket, seen, "transpose_sign",
            _solve_linear(lx, -lc, -rx, rc), true_x,
            "移项时，把含 x 项和常数项跨过等号后都忘记变号了。",
        )
    # 5d. 多项展开后，单个左边常数项移到右边忘变号（如 L2 两个括号展开出两个常数）
    lhs_const_parts = [Fraction(t.outer * t.inner_c) for t in analysis.after_lcm_lhs if t.outer * t.inner_c != 0]
    if len(lhs_const_parts) > 1:
        for part in lhs_const_parts:
            # 该常数项没变号 => 等价于 rhs_c 增加了 2*part（正确是 -part，误算为 +part）
            if analysis.total_a != 0:
                sol = (analysis.total_b + 2 * part) / analysis.total_a
                _add_candidate(
                    bucket, seen, "transpose_sign",
                    sol, true_x,
                    "移项时，左边有某个常数项移到右边后忘记变号了。",
                )

    # ---- 6. coeff_invert: 系数化为 1 分子分母颠倒 ----
    a, b = analysis.total_a, analysis.total_b
    if a != 0 and a not in (1, -1) and b != 0:
        _add_candidate(
            bucket, seen, "coeff_invert",
            a / b, true_x,
            f"化简到 {a}x = {b} 后，应两边同除以 {a}（得 {b}/{a}），可能把分子分母除反了。",
        )
        # 除反同时漏符号
        _add_candidate(
            bucket, seen, "coeff_invert",
            -(a / b), true_x,
            f"化简到 {a}x = {b} 后，系数化为 1 时可能把除数和被除数弄反了。",
        )

    # ---- 7. coeff_sub_div: 系数化为 1 误把除法算成加减或漏除 ----
    if a != 0 and a != 1:
        _add_candidate(
            bucket, seen, "coeff_sub_div",
            b - a, true_x,
            f"化简到 {a}x = {b} 后，应两边同除以 {a}，可能误算成了减法（{b} - {a}）。",
        )
        _add_candidate(
            bucket, seen, "coeff_sub_div",
            b + a, true_x,
            f"化简到 {a}x = {b} 后，应两边同除以 {a}，可能误把系数移过去做了加法。",
        )
        if a != -1:
            _add_candidate(
                bucket, seen, "coeff_sub_div",
                b, true_x,
                f"化简到 {a}x = {b} 后，可能忘记把两边同除以未知数系数 {a}。",
            )

    # ---- 8. sign_flip: 最终结果符号弄反 ----
    if true_x != 0:
        _add_candidate(
            bucket, seen, "sign_flip",
            -true_x, true_x,
            "你的数值大小算对了，但最终结果的正负号弄反了（注意检查负号和异号相除）。",
        )

    return bucket


def generate_synthetic_wrong_sample(
    analysis: EquationAnalysis,
    rng: random.Random,
    noisy_prob: float = 0.12,
    slip_prob: float = 0.16,
) -> tuple[Fraction, str] | None:
    """
    为训练数据集生成一条逼真的“(学生错误答案, 真实错因标签)”样本：
    - 大部分为单一典型错因（8 类）
    - 少量为“主错因 + 轻微计算偏差/符号翻折”的噪声样本，让 GBDT 学会利用软距离特征
    - 一定比例为纯粹的随机计算失误（arithmetic_slip），防止模型过度自信乱猜
    """
    candidates = simulate_bug_candidates(analysis)
    available_codes = [c for c in EQUATION_BUG_CODES if candidates[c]]
    all_exact_vals = {cand.value for cands in candidates.values() for cand in cands}

    # 1. 纯计算失误（arithmetic_slip）
    if not available_codes or rng.random() < slip_prob:
        slip_val = _sample_arithmetic_slip(analysis, all_exact_vals, rng)
        if slip_val is not None:
            return slip_val, "arithmetic_slip"

    if not available_codes:
        return None

    # 2. 按初中生真实错因常见度加权抽样（同时确保每类都能充分采样）
    weights_map = {
        "denom_omit_const": 1.6,
        "denom_mul_error": 1.4,
        "paren_sign": 1.6,
        "paren_omit_mul": 1.3,
        "transpose_sign": 1.5,
        "coeff_invert": 1.0,
        "coeff_sub_div": 0.9,
        "sign_flip": 1.0,
    }
    weights = [weights_map.get(c, 1.0) for c in available_codes]
    chosen_code = rng.choices(available_codes, weights=weights, k=1)[0]
    cand = rng.choice(candidates[chosen_code])

    # 3. 以一定概率叠加轻微噪声（复合错误 / 小算术偏差），锻炼树模型的泛化能力
    if rng.random() < noisy_prob and chosen_code != "sign_flip":
        # 两种噪声：结果再翻一个符号，或在分子常数上 ±1
        if rng.random() < 0.45 and cand.value != 0:
            noisy = -cand.value
        else:
            delta = rng.choice([Fraction(1), Fraction(-1)])
            if analysis.total_a != 0 and abs(analysis.total_a) <= 12 and rng.random() < 0.5:
                noisy = cand.value + delta / abs(analysis.total_a)
            else:
                noisy = cand.value + delta

        # 确保加噪后不等于正确答案，也不恰好撞上其他精确错因（避免错误标注）
        if noisy != analysis.true_x and noisy not in all_exact_vals:
            # 只有当它明显更靠近 chosen_code 而不是 true_x 时才标为 chosen_code
            if abs(noisy - cand.value) < abs(noisy - analysis.true_x):
                return noisy, chosen_code

    return cand.value, chosen_code


def _sample_arithmetic_slip(
    analysis: EquationAnalysis,
    exact_bug_vals: set[Fraction],
    rng: random.Random,
) -> Fraction | None:
    true_x = analysis.true_x
    a, b = analysis.total_a, analysis.total_b
    for _ in range(25):
        mode = rng.random()
        if mode < 0.45:
            # 合并常数项时加减差 1~3
            delta = rng.choice([-3, -2, -1, 1, 2, 3])
            val = (b + delta) / a if a != 0 else true_x + delta
        elif mode < 0.80:
            # 最终答案差 ±1, ±2, ±1/2
            delta = rng.choice([
                Fraction(-2), Fraction(-1), Fraction(1), Fraction(2),
                Fraction(-1, 2), Fraction(1, 2),
            ])
            val = true_x + delta
        else:
            # 随机乱填一个初中常见范围内的有理数
            num = rng.randint(-15, 15)
            den = rng.choice([1, 1, 1, 2, 3, 4])
            val = Fraction(num, den)
        if val != true_x and val not in exact_bug_vals:
            return val
    return None
