from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
import math
import random
from typing import Any

from app.diagnosis.taxonomy import ARITHMETIC_BUG_CODES

ARITHMETIC_KINDS: tuple[str, ...] = (
    "l1_add_sub",
    "l1_mul_div",
    "l2_add_group",
    "l2_sub_group",
    "l2_mul_pair",
    "l2_dist_dec",
    "l3_frac_add_sub",
    "l3_frac_mul_div",
    "l4_dist_frac",
    "l4_power_mix",
)


@dataclass(frozen=True)
class ArithmeticBugCandidate:
    code: str
    value: Fraction
    detail: str


@dataclass(frozen=True)
class ArithmeticAnalysis:
    kind: str
    expected: Fraction
    meta: dict[str, Any]
    is_decimal: bool
    is_fraction: bool


def analyze_arithmetic_meta(meta: dict[str, Any]) -> ArithmeticAnalysis | None:
    if "kind" not in meta or "value" not in meta:
        return None
    kind = str(meta["kind"])
    if kind not in ARITHMETIC_KINDS:
        return None
    expected = Fraction(meta["value"])
    is_decimal = kind.startswith("l2_")
    is_fraction = kind in ("l3_frac_add_sub", "l3_frac_mul_div", "l4_dist_frac")
    return ArithmeticAnalysis(
        kind=kind,
        expected=expected,
        meta=meta,
        is_decimal=is_decimal,
        is_fraction=is_fraction,
    )


def _add_cand(
    bucket: dict[str, list[ArithmeticBugCandidate]],
    seen: dict[str, set[Fraction]],
    code: str,
    val: Fraction | None,
    expected: Fraction,
    detail: str,
) -> None:
    if val is None or val == expected:
        return
    if val in seen[code]:
        return
    seen[code].add(val)
    bucket[code].append(ArithmeticBugCandidate(code=code, value=val, detail=detail))


def simulate_arithmetic_candidates(
    analysis: ArithmeticAnalysis,
) -> dict[str, list[ArithmeticBugCandidate]]:
    """对口算 10 种小题型正向模拟 8 类典型错因，返回候选错误数值与中文说明。"""
    bucket: dict[str, list[ArithmeticBugCandidate]] = {c: [] for c in ARITHMETIC_BUG_CODES}
    seen: dict[str, set[Fraction]] = {c: set() for c in ARITHMETIC_BUG_CODES}
    expected = analysis.expected
    m = analysis.meta
    kind = analysis.kind

    # ---------- L1: 有理数加减 ----------
    if kind == "l1_add_sub":
        a, b, c = int(m["a"]), int(m["b"]), int(m["c"])
        op1, op2 = str(m["op1"]), str(m["op2"])
        b_eff = b if op1 == "+" else -b
        c_eff = c if op2 == "+" else -c

        # 负数去括号/符号错：把第 2 项或第 3 项符号弄反
        _add_cand(
            bucket, seen, "arith_signed_paren",
            Fraction(a - b_eff + c_eff), expected,
            f"处理中间项 {op1} ({b}) 去括号时可能把符号弄反了（同号得正、异号得负）。",
        )
        _add_cand(
            bucket, seen, "arith_signed_paren",
            Fraction(a + b_eff - c_eff), expected,
            f"处理末尾项 {op2} ({c}) 去括号时可能把符号弄反了（减去负数等于加上它的相反数）。",
        )
        _add_cand(
            bucket, seen, "arith_signed_paren",
            Fraction(a - b_eff - c_eff), expected,
            "有理数加减去括号时，可能把后面两项的符号都弄反了。",
        )
        # 忽略首项负号
        if a < 0:
            _add_cand(
                bucket, seen, "arith_signed_paren",
                Fraction(-a + b_eff + c_eff), expected,
                f"最前面一项 {a} 是负数，计算时可能漏掉了开头的负号。",
            )

    # ---------- L1: 整数乘除混合 ----------
    elif kind == "l1_mul_div":
        a, d, c = int(m["a"]), int(m["d"]), int(m["c"])
        # 经典运算顺序错：把 a ÷ d × c 算成 a ÷ (d × c)
        if d * c != 0:
            _add_cand(
                bucket, seen, "arith_order_ops",
                Fraction(a, d * c), expected,
                f"乘除是同级运算，应从左到右先算 {a} ÷ {d}，可能误先算了后面的 {d} × {c}。",
            )
            # 也可能把 a ÷ d × c 算成 (a × c) 忘了除 d，或 (d × c) ÷ a
            if a != 0:
                _add_cand(
                    bucket, seen, "arith_order_ops",
                    Fraction(d * c, a), expected,
                    "乘除混合运算顺序或被除数与除数位置可能弄反了。",
                )

    # ---------- L2: 小数加法凑整 ----------
    elif kind == "l2_add_group":
        # 进位偏差 ±1 或小数点位错
        for delta in (Fraction(-1), Fraction(1)):
            _add_cand(
                bucket, seen, "arith_decimal_place",
                expected + delta, expected,
                "小数部分凑整相加时，整数部分可能漏进 1 或多进了 1。",
            )
        _add_cand(
            bucket, seen, "arith_decimal_place",
            expected * 10, expected,
            "小数点位置可能向右多移了一位，请核对小数位数。",
        )
        _add_cand(
            bucket, seen, "arith_decimal_place",
            expected / 10, expected,
            "小数点位置可能向左多移了一位，请核对小数位数。",
        )

    # ---------- L2: 小数连减凑整 ----------
    elif kind == "l2_sub_group":
        a, b, c = Fraction(m["a"]), Fraction(m["b"]), Fraction(m["c"])
        # 经典连减变号错：a - b - c 错算成 a - (b - c) = a - b + c
        _add_cand(
            bucket, seen, "arith_signed_paren",
            a - b + c, expected,
            "连续减去两个数等于减去这两个数的和（a - b - c = a - (b + c)），可能误算成了相减。",
        )
        # 退位/进位偏差 ±1 或小数点位错
        for delta in (Fraction(-1), Fraction(1)):
            _add_cand(
                bucket, seen, "arith_decimal_place",
                expected + delta, expected,
                "合并两个小数减数或做减法时，可能出现了退位/进位差 1 的情况。",
            )
        _add_cand(
            bucket, seen, "arith_decimal_place",
            expected / 10, expected,
            "小数点位置可能点错了一位，请核对结果量级。",
        )

    # ---------- L2: 小数乘法凑整 (0.25*mid*4 / 1.25*mid*8 / 0.5*mid*2) ----------
    elif kind == "l2_mul_pair":
        p1, mid, p2 = Fraction(m["p1"]), Fraction(m["mid"]), Fraction(m["p2"])
        # 经典小数点位错：把 0.25×4=1 算成 10 或 0.1，把 1.25×8=10 算成 1 或 100
        for factor in (Fraction(10), Fraction(1, 10), Fraction(100), Fraction(1, 100)):
            _add_cand(
                bucket, seen, "arith_decimal_place",
                expected * factor, expected,
                f"小数凑整相乘（{p1} × {p2} = {p1 * p2}）时，小数点位置可能移错了。",
            )
        # 漏乘中间项或把乘法算成加法
        _add_cand(
            bucket, seen, "arith_dist_omit",
            p1 * p2 + mid, expected,
            "凑整后应继续做乘法，可能把最后的乘法误算成了加法。",
        )

    # ---------- L2: 逆用乘法分配律 k*a + k*b (a+b=10) ----------
    elif kind == "l2_dist_dec":
        k, a, b = Fraction(m["k"]), Fraction(m["a"]), Fraction(m["b"])
        # 小数点错位（乘 10 忘记移小数点或移反了）
        for factor in (Fraction(1, 10), Fraction(10)):
            _add_cand(
                bucket, seen, "arith_decimal_place",
                expected * factor, expected,
                "提取公因数凑成 10 后，乘以 10 时小数点向右移一位即可，可能点错位置了。",
            )
        # 提取公因数重复算了两次 k：2 * k * (a + b) 或 k + (a + b)
        _add_cand(
            bucket, seen, "arith_dist_omit",
            2 * k * (a + b), expected,
            "逆用乘法分配律提取公因数时，公因数只需写一次，可能重复乘了 2 倍。",
        )
        _add_cand(
            bucket, seen, "arith_dist_omit",
            k + a + b, expected,
            "提取公因数后是公因数与括号内的和相乘，可能误算成了相加。",
        )
        _add_cand(
            bucket, seen, "arith_order_ops",
            (k * a + k) * b, expected,
            "运算顺序有误：应先分别算乘法（或提取公因数），不能从左到右把加法先并进去。",
        )

    # ---------- L3: 异分母分数加减 ----------
    elif kind == "l3_frac_add_sub":
        f1, f2 = Fraction(m["f1"]), Fraction(m["f2"])
        op = str(m["op"])
        n1, d1 = f1.numerator, f1.denominator
        n2, d2 = f2.numerator, f2.denominator
        s = 1 if op == "+" else -1

        # 分子分母直接相加/相减
        if d1 + d2 != 0:
            _add_cand(
                bucket, seen, "arith_frac_add_raw",
                Fraction(n1 + s * n2, d1 + d2), expected,
                "异分母分数加减不能把分子和分母直接相加减，必须先通分再只算分子。",
            )
        if op == "-" and d1 - d2 != 0:
            _add_cand(
                bucket, seen, "arith_frac_add_raw",
                Fraction(n1 - n2, d1 - d2), expected,
                "分数相减不能用分母减分母、分子减分子，必须先通分。",
            )
        # 取了公分母或乘积分母，但分子忘记乘倍数
        lcm_d = math.lcm(d1, d2)
        _add_cand(
            bucket, seen, "arith_frac_add_raw",
            Fraction(n1 + s * n2, lcm_d), expected,
            f"通分到公分母 {lcm_d} 时，分子也要同时乘以对应倍数，不能直接把原分子相加减。",
        )
        _add_cand(
            bucket, seen, "arith_frac_add_raw",
            Fraction(n1 + s * n2, d1 * d2), expected,
            "通分后分子漏乘了对应的扩倍系数。",
        )
        # 加减号看反 / 负号处理错
        _add_cand(
            bucket, seen, "arith_signed_paren",
            f1 - f2 if op == "+" else f1 + f2, expected,
            "分数加减时的正负号可能弄反了（特别是首项为负数时）。",
        )
        if f1 < 0:
            _add_cand(
                bucket, seen, "arith_signed_paren",
                (-f1 + f2) if op == "+" else (-f1 - f2), expected,
                "第一个分数带有负号，通分合并分子时可能漏掉了开头的负号。",
            )

    # ---------- L3: 分数乘除混合 f1 / f2 * f3 ----------
    elif kind == "l3_frac_mul_div":
        f1, f2, f3 = Fraction(m["f1"]), Fraction(m["f2"]), Fraction(m["f3"])
        # 1. 除法忘记乘倒数，直接连乘 f1 * f2 * f3
        _add_cand(
            bucket, seen, "arith_frac_div_no_inv",
            f1 * f2 * f3, expected,
            "除以一个分数等于乘以它的倒数，可能忘记把除数取倒数、直接相乘了。",
        )
        # 把被除数 f1 倒过来了: (1/f1) * f2 * f3
        if f1 != 0:
            _add_cand(
                bucket, seen, "arith_frac_div_no_inv",
                (Fraction(1) / f1) * f2 * f3, expected,
                "除法变乘法时是把「除数」取倒数，可能误把前面的被除数倒过来了。",
            )
        # 2. 运算顺序错：先算后面乘法 f1 / (f2 * f3)
        if f2 * f3 != 0:
            _add_cand(
                bucket, seen, "arith_order_ops",
                f1 / (f2 * f3), expected,
                "分数乘除是同级运算，应从左到右先算除法，可能误先算了后面的乘法再去除。",
            )

    # ---------- L4: 乘法分配律消分母 k * (f1 op1 f2 op2 f3) ----------
    elif kind == "l4_dist_frac":
        k = int(m["k"])
        f1, f2, f3 = Fraction(m["f1"]), Fraction(m["f2"]), Fraction(m["f3"])
        op1, op2 = str(m["op1"]), str(m["op2"])
        s2 = f2 if op1 == "+" else -f2
        s3 = f3 if op2 == "+" else -f3

        # 1. 分配律漏乘括号里的后项
        _add_cand(
            bucket, seen, "arith_dist_omit",
            k * f1 + s2 + s3, expected,
            f"用乘法分配律展开时，{k} 可能只乘了第一项，漏乘了括号后面的分数项。",
        )
        _add_cand(
            bucket, seen, "arith_dist_omit",
            k * f1 + k * s2 + s3, expected,
            f"用乘法分配律展开时，括号里的最后一项可能漏乘了 {k}。",
        )
        _add_cand(
            bucket, seen, "arith_dist_omit",
            f1 + s2 + s3, expected,
            f"计算括号内分数后，可能忘记乘以外面的系数 {k}。",
        )
        # 2. k 为负数时去括号漏变号
        if k < 0:
            _add_cand(
                bucket, seen, "arith_signed_paren",
                k * f1 - k * s2 - k * s3, expected,
                f"括号外系数 {k} 是负数，展开时括号里后面两项可能忘记变号了。",
            )
            _add_cand(
                bucket, seen, "arith_signed_paren",
                k * f1 + k * s2 - k * s3, expected,
                f"括号外系数 {k} 是负数，展开到最后一项时可能忘记变号了。",
            )
            _add_cand(
                bucket, seen, "arith_signed_paren",
                k * f1 - k * s2 + k * s3, expected,
                f"括号外系数 {k} 是负数，展开到中间项时可能忘记变号了。",
            )

    # ---------- L4: 含乘方的有理数混合运算 ----------
    elif kind == "l4_power_mix":
        base1, exp1 = int(m["base1"]), int(m["exp1"])
        neg_outside = bool(m["neg_outside"])
        base2, mult, c = int(m["base2"]), int(m["m"]), int(m["c"])

        v1 = -(base1 ** exp1) if neg_outside else ((-base1) ** exp1)
        v2 = base2 ** 2

        # 1. 乘方负号位置混淆：把 -a^2 当成 (-a)^2，或把 (-a)^2 当成 -a^2，或把 (-a)^3 当成正数
        _add_cand(
            bucket, seen, "arith_power_sign",
            Fraction(-v1 + v2 * mult - c), expected,
            "第一项乘方的正负号可能弄混了：注意 -a² 是先平方再取负，(-a)² 是负数的平方。",
        )
        if base2 < 0:
            _add_cand(
                bucket, seen, "arith_power_sign",
                Fraction(v1 + (-v2) * mult - c), expected,
                f"({base2})² 的底数是负数且在括号内，平方后应为正数 {v2}，可能误算成了 -{v2}。",
            )
        # 乘方当乘法算（如 2^3 = 6）
        v1_mul = -(base1 * exp1) if neg_outside else ((-base1) * exp1 if exp1 % 2 == 1 else base1 * exp1)
        _add_cand(
            bucket, seen, "arith_power_sign",
            Fraction(v1_mul + v2 * mult - c), expected,
            f"乘方表示连乘，{base1}^{exp1} 应为 {base1 ** exp1}，可能误算成了底数乘指数 {base1 * exp1}。",
        )

        # 2. 运算顺序错：先加减再乘
        _add_cand(
            bucket, seen, "arith_order_ops",
            Fraction((v1 + v2) * mult - c), expected,
            "混合运算应「先乘方、再乘除、后加减」，可能误先把前两项相加再做乘法了。",
        )
        _add_cand(
            bucket, seen, "arith_order_ops",
            Fraction(v1 + v2 * (mult - c)), expected,
            "应先算乘法再算后面的减法，可能把后面的减法先算了。",
        )

        # 3. 末尾减负数变号错: -(-c) 算成 -|c|
        _add_cand(
            bucket, seen, "arith_signed_paren",
            Fraction(v1 + v2 * mult + c), expected,
            f"末尾项 - ({c}) 去括号时可能把符号弄反了。",
        )

    # ---------- 通用 8. arith_sign_flip: 最终符号弄反 ----------
    if expected != 0:
        _add_cand(
            bucket, seen, "arith_sign_flip",
            -expected, expected,
            "你的数值大小算对了，但最终结果的正负号弄反了。",
        )

    return bucket


def generate_synthetic_arithmetic_sample(
    analysis: ArithmeticAnalysis,
    rng: random.Random,
    noisy_prob: float = 0.08,
    slip_prob: float = 0.16,
) -> tuple[Fraction, str] | None:
    candidates = simulate_arithmetic_candidates(analysis)
    available = [c for c in ARITHMETIC_BUG_CODES if candidates[c]]
    exact_vals = {cand.value for cands in candidates.values() for cand in cands}

    if not available or rng.random() < slip_prob:
        slip = _sample_arithmetic_slip(analysis, exact_vals, rng)
        if slip is not None:
            return slip, "arithmetic_slip"

    if not available:
        return None

    weights_map = {
        "arith_order_ops": 1.5,
        "arith_signed_paren": 1.5,
        "arith_power_sign": 1.6,
        "arith_frac_div_no_inv": 1.5,
        "arith_frac_add_raw": 1.5,
        "arith_decimal_place": 1.4,
        "arith_dist_omit": 1.4,
        "arith_sign_flip": 1.0,
    }
    weights = [weights_map.get(c, 1.0) for c in available]
    chosen = rng.choices(available, weights=weights, k=1)[0]
    cand = rng.choice(candidates[chosen])

    # 少量“主错因 + 最终符号翻折”的复合样本
    if rng.random() < noisy_prob and chosen != "arith_sign_flip" and cand.value != 0:
        noisy = -cand.value
        if noisy != analysis.expected and noisy not in exact_vals:
            return noisy, chosen

    return cand.value, chosen


def _sample_arithmetic_slip(
    analysis: ArithmeticAnalysis,
    exact_vals: set[Fraction],
    rng: random.Random,
) -> Fraction | None:
    exp = analysis.expected
    for _ in range(25):
        mode = rng.random()
        if analysis.is_decimal:
            if mode < 0.6:
                delta = Fraction(rng.choice([-3, -2, 2, 3, -5, 5]), 10)
                val = exp + delta
            else:
                val = Fraction(rng.randint(-50, 150), 10)
        elif analysis.is_fraction:
            if mode < 0.6:
                delta = Fraction(rng.choice([-2, -1, 1, 2]), max(2, exp.denominator))
                val = exp + delta
            else:
                val = Fraction(rng.randint(-15, 15), rng.choice([2, 3, 4, 5, 6]))
        else:
            if mode < 0.65:
                delta = Fraction(rng.choice([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]))
                val = exp + delta
            else:
                val = Fraction(rng.randint(-40, 40))
        if val != exp and val not in exact_vals:
            return val
    return None
