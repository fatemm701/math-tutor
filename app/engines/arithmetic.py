from __future__ import annotations

from fractions import Fraction
import math
import random

from app.diagnosis.predictor import diagnose_arithmetic
from app.engines.rational import (
    frac_to_decimal_str,
    frac_to_raw,
    frac_to_tex,
    parse_number_strict,
)
from app.engines.types import GradeResult, Question, Step


def _signed_wrap(val: int | Fraction, is_dec: bool = False, tex: bool = False) -> str:
    """负数加括号用于运算中（如 (-3)），正数直接输出。"""
    if isinstance(val, int):
        return f"({val})" if val < 0 else str(val)
    if is_dec:
        s = frac_to_decimal_str(val)
    else:
        s = frac_to_tex(val) if tex else frac_to_raw(val)
    if val < 0:
        return f"\\left({s}\\right)" if tex and not is_dec and val.denominator > 1 else f"({s})"
    return s


def _fmt_ans(val: Fraction, is_decimal: bool) -> tuple[str, str]:
    """根据题面类型决定标准答案的 raw 与 tex 格式。"""
    if is_decimal:
        s = frac_to_decimal_str(val)
        return s, s
    return frac_to_raw(val), frac_to_tex(val)


# ---------- L1: 有理数加减 / 整数乘除 ----------

def _gen_l1(rng: random.Random) -> Question:
    if rng.random() < 0.6:
        # 三数有理数加减（含负数括号）
        a = rng.randint(-15, 15)
        b = rng.choice([i for i in range(-15, 16) if i != 0])
        c = rng.choice([i for i in range(-15, 16) if i != 0])
        op1 = rng.choice(["+", "-"])
        op2 = rng.choice(["+", "-"])

        ans = a + (b if op1 == "+" else -b) + (c if op2 == "+" else -c)
        raw = f"{_signed_wrap(a)} {op1} {_signed_wrap(b)} {op2} {_signed_wrap(c)}"
        tex = raw

        # 去括号后的等价形式
        b_eff = b if op1 == "+" else -b
        c_eff = c if op2 == "+" else -c
        step1_tex = f"{a} {'+' if b_eff >= 0 else '-'} {abs(b_eff)} {'+' if c_eff >= 0 else '-'} {abs(c_eff)}"
        step2_tex = f"{a + b_eff} {'+' if c_eff >= 0 else '-'} {abs(c_eff)} = {ans}"

        steps = [
            Step("去括号", step1_tex, "减去一个数等于加上它的相反数（同号得正，异号得负）。"),
            Step("依次计算", step2_tex, "从左到右依次相加减。"),
        ]
        hint = "先去括号统一成加减法（如 -(-a) = +a），再从左到右计算。"
        meta_extra: dict[str, object] = {"kind": "l1_add_sub", "a": a, "b": b, "c": c, "op1": op1, "op2": op2}
    else:
        # 整数乘除混合（保证整除）
        d = rng.choice([-6, -5, -4, -3, -2, 2, 3, 4, 5, 6])
        q = rng.choice([i for i in range(-9, 10) if i != 0])
        a = d * q
        c = rng.choice([i for i in range(-6, 7) if i not in (0, 1, -1)])
        ans = q * c

        raw = f"{_signed_wrap(a)} / {_signed_wrap(d)} * {_signed_wrap(c)}"
        tex = f"{_signed_wrap(a)} \\div {_signed_wrap(d)} \\times {_signed_wrap(c)}"
        steps = [
            Step("先算除法", f"{_signed_wrap(q)} \\times {_signed_wrap(c)}", f"同级运算从左到右：{a} ÷ {d} = {q}。"),
            Step("再算乘法", str(ans), "同号得正，异号得负。"),
        ]
        hint = "乘除为同级运算，按从左到右顺序先算除法，注意确定最终符号。"
        meta_extra = {"kind": "l1_mul_div", "a": a, "d": d, "c": c}

    ans_val = Fraction(ans)
    ans_raw, ans_tex = _fmt_ans(ans_val, is_decimal=False)
    return Question(
        topic="arithmetic",
        level=1,
        prompt_raw=raw,
        prompt_tex=tex,
        answer_raw=ans_raw,
        answer_tex=ans_tex,
        hint=hint,
        steps=steps,
        meta={"value": frac_to_raw(ans_val), **meta_extra},
    )


# ---------- L2: 小数四则与凑整简算 ----------

def _gen_l2(rng: random.Random) -> Question:
    kind = rng.choice(["add_group", "sub_group", "mul_pair", "dist_dec"])

    if kind == "add_group":
        # a + b + c，其中 a + c 凑整
        a_int = rng.randint(1, 9)
        a_dec = rng.choice([1, 2, 3, 4, 6, 7, 8, 9])
        a = Fraction(a_int * 10 + a_dec, 10)
        c_int = rng.randint(1, 9)
        c = Fraction(c_int * 10 + (10 - a_dec), 10)
        b = Fraction(rng.randint(11, 89), 10)
        ans = a + b + c

        sa, sb, sc = map(frac_to_decimal_str, (a, b, c))
        raw = f"{sa} + {sb} + {sc}"
        tex = raw
        steps = [
            Step("加法交换律与结合律", f"({sa} + {sc}) + {sb}", "把小数部分能凑成整数的两项先相加。"),
            Step("得出结果", f"{frac_to_decimal_str(a + c)} + {sb} = {frac_to_decimal_str(ans)}"),
        ]
        hint = f"观察小数部分，可以先算 {sa} + {sc} 凑整。"
        meta_extra: dict[str, object] = {
            "kind": "l2_add_group", "a": frac_to_raw(a), "b": frac_to_raw(b), "c": frac_to_raw(c),
        }

    elif kind == "sub_group":
        # a - b - c，其中 b + c 凑整
        b_dec = rng.choice([25, 35, 45, 65, 75])
        b = Fraction(rng.randint(1, 5) * 100 + b_dec, 100)
        c = Fraction(rng.randint(1, 5) * 100 + (100 - b_dec), 100)
        a = Fraction(rng.randint(10, 25) * 10 + rng.randint(1, 9), 10)
        ans = a - b - c

        sa, sb, sc = map(frac_to_decimal_str, (a, b, c))
        raw = f"{sa} - {sb} - {sc}"
        tex = raw
        steps = [
            Step("利用减法性质", f"{sa} - ({sb} + {sc})", "连续减去两个数，等于减去这两个数的和。"),
            Step("得出结果", f"{sa} - {frac_to_decimal_str(b + c)} = {frac_to_decimal_str(ans)}"),
        ]
        hint = f"把后两个减数合并：先算 {sb} + {sc} 凑整。"
        meta_extra = {
            "kind": "l2_sub_group", "a": frac_to_raw(a), "b": frac_to_raw(b), "c": frac_to_raw(c),
        }

    elif kind == "mul_pair":
        # 0.25 * x * 4 或 1.25 * x * 8
        p1, p2 = rng.choice([(Fraction(1, 4), Fraction(4)), (Fraction(5, 4), Fraction(8)), (Fraction(1, 2), Fraction(2))])
        mid = Fraction(rng.randint(11, 49), 10)
        ans = p1 * mid * p2

        s1, sm, s2 = map(frac_to_decimal_str, (p1, mid, p2))
        raw = f"{s1} * {sm} * {s2}"
        tex = f"{s1} \\times {sm} \\times {s2}"
        steps = [
            Step("乘法交换律与结合律", f"({s1} \\times {s2}) \\times {sm}", f"{s1} × {s2} = {frac_to_decimal_str(p1 * p2)}，先凑整再乘。"),
            Step("得出结果", f"{frac_to_decimal_str(p1 * p2)} \\times {sm} = {frac_to_decimal_str(ans)}"),
        ]
        hint = f"先算 {s1} × {s2} 凑成整数，再乘以 {sm}。"
        meta_extra = {
            "kind": "l2_mul_pair", "p1": frac_to_raw(p1), "mid": frac_to_raw(mid), "p2": frac_to_raw(p2),
        }

    else:
        # 乘法分配律：k * a + k * b，其中 a + b = 10
        k = Fraction(rng.randint(12, 48), 10)
        a_10 = rng.randint(12, 88)
        a = Fraction(a_10, 10)
        b = Fraction(100 - a_10, 10)
        ans = k * (a + b)

        sk, sa, sb = map(frac_to_decimal_str, (k, a, b))
        raw = f"{sk} * {sa} + {sk} * {sb}"
        tex = f"{sk} \\times {sa} + {sk} \\times {sb}"
        steps = [
            Step("逆用乘法分配律", f"{sk} \\times ({sa} + {sb})", f"提取公因数 {sk}。"),
            Step("得出结果", f"{sk} \\times 10 = {frac_to_decimal_str(ans)}"),
        ]
        hint = f"两项都含有公因数 {sk}，提取出来后括号内正好凑成 10。"
        meta_extra = {
            "kind": "l2_dist_dec", "k": frac_to_raw(k), "a": frac_to_raw(a), "b": frac_to_raw(b),
        }

    ans_raw, ans_tex = _fmt_ans(ans, is_decimal=True)
    return Question(
        topic="arithmetic",
        level=2,
        prompt_raw=raw,
        prompt_tex=tex,
        answer_raw=ans_raw,
        answer_tex=ans_tex,
        hint=hint,
        steps=steps,
        is_decimal=True,
        meta={"value": frac_to_raw(ans), **meta_extra},
    )


# ---------- L3: 分数四则运算 ----------

def _rand_frac(rng: random.Random, dens: list[int], allow_neg: bool = True) -> Fraction:
    d = rng.choice(dens)
    nums = [n for n in range(1, d * 2) if math.gcd(n, d) == 1]
    n = rng.choice(nums)
    if allow_neg and rng.random() < 0.45:
        n = -n
    return Fraction(n, d)


def _gen_l3(rng: random.Random) -> Question:
    if rng.random() < 0.55:
        # 异分母分数加减（2~3 项）
        dens = rng.sample([2, 3, 4, 5, 6, 8], 2)
        f1 = _rand_frac(rng, [dens[0]])
        f2 = _rand_frac(rng, [dens[1]], allow_neg=False)
        op = rng.choice(["+", "-"])
        ans = f1 + f2 if op == "+" else f1 - f2

        lcm_d = math.lcm(f1.denominator, f2.denominator)
        n1 = f1.numerator * (lcm_d // f1.denominator)
        n2 = f2.numerator * (lcm_d // f2.denominator)

        raw = f"{frac_to_raw(f1)} {op} {frac_to_raw(f2)}"
        tex = f"{frac_to_tex(f1)} {op} {frac_to_tex(f2)}"
        steps = [
            Step(
                "通分",
                f"\\dfrac{{{n1}}}{{{lcm_d}}} {op} \\dfrac{{{n2}}}{{{lcm_d}}}",
                f"分母 {f1.denominator} 与 {f2.denominator} 的最小公倍数是 {lcm_d}。",
            ),
            Step(
                "分子相加减并约分",
                f"\\dfrac{{{n1 + n2 if op == '+' else n1 - n2}}}{{{lcm_d}}} = {frac_to_tex(ans)}",
                "结果化为最简分数。",
            ),
        ]
        hint = f"先通分（公分母取 {lcm_d}），再把分子相加减，最后约分。"
        meta_extra: dict[str, object] = {
            "kind": "l3_frac_add_sub", "f1": frac_to_raw(f1), "f2": frac_to_raw(f2), "op": op,
        }
    else:
        # 分数乘除混合
        f1 = _rand_frac(rng, [2, 3, 4, 5, 6])
        f2 = _rand_frac(rng, [2, 3, 4, 5, 6])
        f3 = _rand_frac(rng, [2, 3, 4, 5])
        ans = f1 / f2 * f3

        raw = f"{_signed_wrap(f1)} / {_signed_wrap(f2)} * {_signed_wrap(f3)}"
        tex = f"{_signed_wrap(f1, tex=True)} \\div {_signed_wrap(f2, tex=True)} \\times {_signed_wrap(f3, tex=True)}"
        inv_f2 = Fraction(1, 1) / f2
        steps = [
            Step(
                "除法变乘法",
                f"{_signed_wrap(f1, tex=True)} \\times {_signed_wrap(inv_f2, tex=True)} \\times {_signed_wrap(f3, tex=True)}",
                "除以一个非零分数等于乘以它的倒数。",
            ),
            Step(
                "约分相乘",
                frac_to_tex(ans),
                "先确定符号（负因数个数决定），再交叉约分求积。",
            ),
        ]
        hint = "先把除法转化为乘以倒数，再确定正负号并交叉约分。"
        meta_extra = {
            "kind": "l3_frac_mul_div",
            "f1": frac_to_raw(f1),
            "f2": frac_to_raw(f2),
            "f3": frac_to_raw(f3),
        }

    ans_raw, ans_tex = _fmt_ans(ans, is_decimal=False)
    return Question(
        topic="arithmetic",
        level=3,
        prompt_raw=raw,
        prompt_tex=tex,
        answer_raw=ans_raw,
        answer_tex=ans_tex,
        hint=hint,
        steps=steps,
        is_fraction=True,
        meta={"value": frac_to_raw(ans), **meta_extra},
    )


# ---------- L4: 综合简算与乘方混合 ----------

def _gen_l4(rng: random.Random) -> Question:
    kind = rng.choice(["dist_frac", "power_mix"])

    if kind == "dist_frac":
        # k * (f1 + f2 - f3)，k 为三者分母的公倍数，展开全变整数
        d1, d2, d3 = rng.sample([2, 3, 4, 6, 8], 3)
        k = math.lcm(d1, d2, d3)
        if k > 36:
            d1, d2, d3 = 2, 3, 4
            k = 12
        if rng.random() < 0.4:
            k = -k

        f1 = _rand_frac(rng, [d1], allow_neg=False)
        f2 = _rand_frac(rng, [d2], allow_neg=False)
        f3 = _rand_frac(rng, [d3], allow_neg=False)
        op1 = rng.choice(["+", "-"])
        op2 = rng.choice(["+", "-"])

        t1 = int(k * f1)
        t2 = int(k * (f2 if op1 == "+" else -f2))
        t3 = int(k * (f3 if op2 == "+" else -f3))
        ans = Fraction(t1 + t2 + t3)

        raw = f"{_signed_wrap(k)} * ({frac_to_raw(f1)} {op1} {frac_to_raw(f2)} {op2} {frac_to_raw(f3)})"
        tex = f"{_signed_wrap(k)} \\times \\left({frac_to_tex(f1)} {op1} {frac_to_tex(f2)} {op2} {frac_to_tex(f3)}\\right)"
        expanded = f"{t1} {'+' if t2 >= 0 else '-'} {abs(t2)} {'+' if t3 >= 0 else '-'} {abs(t3)}"
        steps = [
            Step("乘法分配律展开", expanded, f"用 {k} 分别乘以括号内的每一项，直接消去分母。"),
            Step("合并计算", str(int(ans)), "按整数加减得出结果。"),
        ]
        hint = f"不要先通分！直接用乘法分配律把 {k} 乘进括号里，各项都能直接约成整数。"
        is_frac = True
        meta_extra: dict[str, object] = {
            "kind": "l4_dist_frac",
            "k": k,
            "f1": frac_to_raw(f1),
            "f2": frac_to_raw(f2),
            "f3": frac_to_raw(f3),
            "op1": op1,
            "op2": op2,
        }
    else:
        # 含乘方的有理数混合运算，如 -2^2 + (-3)^2 * 2 - (-4)
        base1 = rng.choice([2, 3])
        exp1 = rng.choice([2, 3])
        neg_outside = rng.choice([True, False])
        if neg_outside:
            p1_raw = f"-{base1}^{exp1}"
            p1_tex = f"-{base1}^{{{exp1}}}"
            v1 = -(base1 ** exp1)
        else:
            p1_raw = f"(-{base1})^{exp1}"
            p1_tex = f"(-{base1})^{{{exp1}}}"
            v1 = (-base1) ** exp1

        base2 = rng.choice([-3, -2, 2, 3])
        v2 = base2 ** 2
        m = rng.choice([-3, -2, 2, 3])
        c = rng.choice([i for i in range(-8, 9) if i != 0])
        ans = Fraction(v1 + v2 * m - c)

        raw = f"{p1_raw} + {_signed_wrap(base2)}^2 * {_signed_wrap(m)} - {_signed_wrap(c)}"
        tex = f"{p1_tex} + {_signed_wrap(base2)}^{{2}} \\times {_signed_wrap(m)} - {_signed_wrap(c)}"
        steps = [
            Step("先算乘方", f"{v1} + {v2} \\times {_signed_wrap(m)} - {_signed_wrap(c)}", "注意区分 -a²（先平方再取负）与 (-a)²（底数为负数）。"),
            Step("再算乘除", f"{v1} {'+' if v2 * m >= 0 else '-'} {abs(v2 * m)} {'+' if -c >= 0 else '-'} {abs(c)}"),
            Step("最后算加减", str(int(ans))),
        ]
        hint = "按「先乘方、再乘除、后加减」的顺序计算，特别注意负号是否在括号内。"
        is_frac = False
        meta_extra = {
            "kind": "l4_power_mix",
            "base1": base1,
            "exp1": exp1,
            "neg_outside": neg_outside,
            "base2": base2,
            "m": m,
            "c": c,
        }

    ans_raw, ans_tex = _fmt_ans(ans, is_decimal=False)
    return Question(
        topic="arithmetic",
        level=4,
        prompt_raw=raw,
        prompt_tex=tex,
        answer_raw=ans_raw,
        answer_tex=ans_tex,
        hint=hint,
        steps=steps,
        is_fraction=is_frac,
        meta={"value": frac_to_raw(ans), **meta_extra},
    )


def generate(level: int, rng: random.Random | None = None) -> Question:
    if level not in (1, 2, 3, 4):
        raise ValueError(f"不支持的难度等级: {level}")
    r = rng or random.Random()
    generators = {1: _gen_l1, 2: _gen_l2, 3: _gen_l3, 4: _gen_l4}
    return generators[level](r)


# ---------- 判卷逻辑 ----------

def grade(
    question: Question,
    student_input: str,
    *,
    user_priors: dict[str, float] | None = None,
) -> GradeResult:
    raw = (
        student_input.strip()
        .replace("−", "-")
        .replace("－", "-")
        .replace("＋", "+")
    )
    if not raw:
        return GradeResult("error", False, "请输入你的答案。")

    expected = Fraction(question.meta["value"])

    try:
        val, unreduced = parse_number_strict(raw)
    except ValueError:
        return GradeResult("error", False, "请输入一个有效的整数、小数或分数（如 -3/4 或 1.25）。")

    # 渲染学生输入：若为小数保留小数形式，否则按分数渲染
    if "." in raw:
        student_tex = raw
    elif "/" in raw:
        num_s, den_s = (p.strip() for p in raw.split("/", 1))
        student_tex = f"\\dfrac{{{num_s}}}{{{den_s}}}"
    else:
        student_tex = frac_to_tex(val)

    if val != expected:
        diag = diagnose_arithmetic(question, val, user_priors=user_priors)
        return GradeResult(
            "wrong",
            False,
            "计算结果不正确，请检查符号或运算顺序。",
            student_tex,
            diagnosis=diag,
        )

    if unreduced:
        return GradeResult(
            "unreduced",
            False,
            "数值正确，但分数还可以继续约分（分母应为正整数）。",
            student_tex,
        )

    return GradeResult("correct", True, "回答正确！", student_tex)