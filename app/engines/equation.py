from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
import math
import random

from app.diagnosis.predictor import diagnose_equation
from app.engines.expr_tree import (
    BinOpNode,
    ExprNode,
    NumNode,
    ParseError,
    Poly,
    UnaryNode,
    VarNode,
    ZERO_KEY,
    expand,
    node_to_tex,
    parse_expr,
    poly_sub,
)
from app.engines.rational import frac_to_raw, frac_to_tex, parse_number_strict
from app.engines.types import GradeResult, Question, Step

X_KEY = (1, 0, 0, 0)


# ---------- 结构化项定义 ----------

@dataclass(frozen=True)
class _Term:
    """
    表示方程一侧的一个项：
      outer * (inner_x * x + inner_c) / den
    - 普通一次项：outer=a, inner_x=1, inner_c=0, den=1, is_paren=False
    - 普通常数项：outer=c, inner_x=0, inner_c=1, den=1, is_paren=False
    - 括号项：    outer=k, inner_x=a, inner_c=b, den=1, is_paren=True
    - 分式项：    outer=k, inner_x=a, inner_c=b, den=d (d > 1), is_paren=(k != 1 and inner_x != 0 and inner_c != 0)
    """
    outer: int
    inner_x: int
    inner_c: int
    den: int = 1
    is_paren: bool = False

    def eval_coeffs(self) -> tuple[Fraction, Fraction]:
        """返回展开后的 (x 系数, 常数项)。"""
        k = Fraction(self.outer, self.den)
        return k * self.inner_x, k * self.inner_c

    def to_dict(self) -> dict[str, int | bool]:
        return {
            "outer": self.outer,
            "inner_x": self.inner_x,
            "inner_c": self.inner_c,
            "den": self.den,
            "is_paren": self.is_paren,
        }


def _fmt_linear(a: int, b: int, tex: bool = False) -> str:
    """格式化整系数一次式 a*x + b。"""
    parts: list[str] = []
    if a != 0:
        if a == 1:
            parts.append("x")
        elif a == -1:
            parts.append("-x")
        else:
            parts.append(f"{a}x")
    if b != 0:
        if not parts:
            parts.append(str(b))
        elif b > 0:
            parts.append(f" + {b}")
        else:
            parts.append(f" - {-b}")
    return "".join(parts) if parts else "0"


def _fmt_term(t: _Term, is_first: bool, tex: bool = False) -> str:
    """格式化单个项（含前导符号）。"""
    neg = t.outer < 0
    abs_o = abs(t.outer)

    if is_first:
        prefix = "-" if neg else ""
    else:
        prefix = " - " if neg else " + "

    # 1. 分式项
    if t.den > 1:
        inner_str = _fmt_linear(t.inner_x, t.inner_c, tex=tex)
        if abs_o == 1:
            num_str = inner_str
        elif t.inner_x != 0 and t.inner_c != 0:
            num_str = f"{abs_o}({inner_str})"
        else:
            # 单项乘常数直接合并
            num_str = _fmt_linear(abs_o * t.inner_x, abs_o * t.inner_c, tex=tex)

        if tex:
            return f"{prefix}\\dfrac{{{num_str}}}{{{t.den}}}"
        # raw 模式下，若分子含加减号则加括号
        if (" + " in num_str or " - " in num_str) and not (
            abs_o > 1 and t.inner_x != 0 and t.inner_c != 0
        ):
            return f"{prefix}({num_str})/{t.den}"
        return f"{prefix}{num_str}/{t.den}"

    # 2. 括号项
    if t.is_paren:
        inner_str = _fmt_linear(t.inner_x, t.inner_c, tex=tex)
        coeff_str = "" if abs_o == 1 else str(abs_o)
        return f"{prefix}{coeff_str}({inner_str})"

    # 3. 普通项（一次项或常数项）
    if t.inner_x != 0 and t.inner_c == 0:
        a = abs_o * t.inner_x
        if a < 0:
            # 理论上不会出现，兜底处理
            a = -a
            prefix = ("-" if not neg else "") if is_first else (" - " if not neg else " + ")
        body = "x" if a == 1 else f"{a}x"
        return f"{prefix}{body}"

    c = abs_o * t.inner_c
    return f"{prefix}{c}"


def _fmt_side(terms: list[_Term], tex: bool = False) -> str:
    if not terms:
        return "0"
    return "".join(_fmt_term(t, i == 0, tex=tex) for i, t in enumerate(terms))


def _fmt_linear_frac(a: Fraction, b: Fraction, tex: bool = False) -> str:
    """格式化有理系数一次式 a*x + b。"""
    parts: list[str] = []
    if a != 0:
        if a == 1:
            parts.append("x")
        elif a == -1:
            parts.append("-x")
        else:
            c_str = frac_to_tex(a) if tex else frac_to_raw(a)
            parts.append(f"{c_str}x")
    if b != 0:
        if not parts:
            parts.append(frac_to_tex(b) if tex else frac_to_raw(b))
        elif b > 0:
            b_str = frac_to_tex(b) if tex else frac_to_raw(b)
            parts.append(f" + {b_str}")
        else:
            b_str = frac_to_tex(-b) if tex else frac_to_raw(-b)
            parts.append(f" - {b_str}")
    return "".join(parts) if parts else "0"


# ---------- 五步等价变形生成 ----------

def _build_steps(lhs: list[_Term], rhs: list[_Term], x0: Fraction) -> list[Step]:
    steps: list[Step] = []

    # 检查是否需要去分母
    dens = [t.den for t in lhs + rhs if t.den > 1]
    lcm_val = math.lcm(*dens) if dens else 1

    cur_lhs = lhs
    cur_rhs = rhs

    # Step 1: 去分母
    if lcm_val > 1:
        def _mul_lcm(terms: list[_Term]) -> list[_Term]:
            res: list[_Term] = []
            for t in terms:
                factor = lcm_val // t.den
                new_outer = t.outer * factor
                is_paren = (t.inner_x != 0 and t.inner_c != 0) and (
                    t.is_paren or abs(new_outer) != 1 or new_outer < 0
                )
                res.append(_Term(new_outer, t.inner_x, t.inner_c, den=1, is_paren=is_paren))
            return res

        cur_lhs = _mul_lcm(cur_lhs)
        cur_rhs = _mul_lcm(cur_rhs)
        steps.append(
            Step(
                title="去分母",
                tex=f"{_fmt_side(cur_lhs, tex=True)} = {_fmt_side(cur_rhs, tex=True)}",
                note=f"方程两边同乘各分母的最小公倍数 {lcm_val}（注意常数项不要漏乘）。",
            )
        )

    # Step 2: 去括号
    has_paren = any(t.is_paren for t in cur_lhs + cur_rhs)
    if has_paren:
        def _expand_side(terms: list[_Term]) -> list[_Term]:
            out: list[_Term] = []
            for t in terms:
                ax = t.outer * t.inner_x
                cc = t.outer * t.inner_c
                if ax != 0:
                    out.append(_Term(ax, 1, 0, den=1, is_paren=False))
                if cc != 0:
                    out.append(_Term(cc, 0, 1, den=1, is_paren=False))
            return out

        cur_lhs = _expand_side(cur_lhs)
        cur_rhs = _expand_side(cur_rhs)
        steps.append(
            Step(
                title="去括号",
                tex=f"{_fmt_side(cur_lhs, tex=True)} = {_fmt_side(cur_rhs, tex=True)}",
                note="利用乘法分配律展开括号，括号前是负号时，括号内各项要变号。",
            )
        )

    # Step 3: 移项（含 x 的移到左边，常数项移到右边）
    lhs_x_terms: list[_Term] = []
    rhs_c_terms: list[_Term] = []
    need_move = False

    for t in cur_lhs:
        if t.inner_x != 0:
            lhs_x_terms.append(_Term(t.outer * t.inner_x, 1, 0))
        else:
            need_move = True
            rhs_c_terms.append(_Term(-t.outer * t.inner_c, 0, 1))

    for t in cur_rhs:
        if t.inner_x != 0:
            need_move = True
            lhs_x_terms.append(_Term(-t.outer * t.inner_x, 1, 0))
        else:
            rhs_c_terms.append(_Term(t.outer * t.inner_c, 0, 1))

    if need_move:
        steps.append(
            Step(
                title="移项",
                tex=f"{_fmt_side(lhs_x_terms, tex=True)} = {_fmt_side(rhs_c_terms, tex=True)}",
                note="将含 x 的项移到等号左边，常数项移到等号右边，移项要变号。",
            )
        )

    # Step 4: 合并同类项
    total_a = sum((Fraction(t.outer) for t in lhs_x_terms), Fraction(0))
    total_b = sum((Fraction(t.outer) for t in rhs_c_terms), Fraction(0))

    if len(lhs_x_terms) > 1 or len(rhs_c_terms) > 1 or not need_move:
        steps.append(
            Step(
                title="合并同类项",
                tex=f"{_fmt_linear_frac(total_a, Fraction(0), tex=True)} = {frac_to_tex(total_b)}",
                note="将等号两边的同类项分别合并，化为 ax = b 的形式。",
            )
        )

    # Step 5: 系数化为 1
    if total_a != 1:
        steps.append(
            Step(
                title="系数化为 1",
                tex=f"x = {frac_to_tex(x0)}",
                note=f"两边同除以 {frac_to_raw(total_a)}，化简得最终解。",
            )
        )

    return steps


# ---------- 四档题目生成器 ----------

def _nonzero(rng: random.Random, lo: int, hi: int) -> int:
    v = 0
    while v == 0:
        v = rng.randint(lo, hi)
    return v


def _gen_l1(rng: random.Random) -> tuple[list[_Term], list[_Term], Fraction, str]:
    """L1: 移项 + 合并同类项，如 3x - 5 = x + 7，整数解。"""
    x0 = Fraction(rng.randint(-9, 9))
    a1 = _nonzero(rng, -6, 6)
    a2 = _nonzero(rng, -6, 6)
    while a1 == a2:
        a2 = _nonzero(rng, -6, 6)
    c1 = _nonzero(rng, -12, 12)
    c2 = int((a1 - a2) * x0 + c1)

    lhs = [_Term(a1, 1, 0), _Term(c1, 0, 1)]
    rhs = [_Term(a2, 1, 0)]
    if c2 != 0:
        rhs.append(_Term(c2, 0, 1))
    hint = "先把含 x 的项移到等号左边，常数项移到右边，注意移项要变号。"
    return lhs, rhs, x0, hint


def _gen_l2(rng: random.Random) -> tuple[list[_Term], list[_Term], Fraction, str]:
    """L2: 含一层括号（含负号去括号），如 2(x - 3) - (4 - x) = 5。"""
    # 70% 整数解，30% 半整数解
    if rng.random() < 0.7:
        x0 = Fraction(rng.randint(-8, 8))
    else:
        x0 = Fraction(rng.choice([-7, -5, -3, -1, 1, 3, 5, 7]), 2)

    k1 = _nonzero(rng, -4, 4)
    a1 = _nonzero(rng, 1, 3)
    b1 = _nonzero(rng, -5, 5)

    # 第二个括号偏向负系数，强化去括号变号训练
    k2 = rng.choice([-3, -2, -1, -1, 2, 3])
    a2 = _nonzero(rng, 1, 3)
    b2 = _nonzero(rng, -5, 5)

    # 确保合并后 x 系数不为 0
    while k1 * a1 + k2 * a2 == 0:
        a2 = _nonzero(rng, 1, 3)

    rhs_val = (k1 * a1 + k2 * a2) * x0 + (k1 * b1 + k2 * b2)
    # 若右侧不是整数，把一个 x 项放到右边重新配平
    if rhs_val.denominator != 1:
        x0 = Fraction(rng.randint(-6, 6))
        rhs_val = (k1 * a1 + k2 * a2) * x0 + (k1 * b1 + k2 * b2)

    lhs = [
        _Term(k1, a1, b1, den=1, is_paren=True),
        _Term(k2, a2, b2, den=1, is_paren=True),
    ]
    rhs = [_Term(int(rhs_val), 0, 1)]
    hint = "先去括号（括号前是负号时，里面每一项都要变号），再移项合并同类项。"
    return lhs, rhs, x0, hint


def _gen_l3(rng: random.Random) -> tuple[list[_Term], list[_Term], Fraction, str]:
    """L3: 含分母（2 个分式项 + 常数项），如 (x-1)/2 - (2x+1)/3 = 1。"""
    d1, d2 = rng.sample([2, 3, 4, 5, 6], 2)
    a1 = _nonzero(rng, 1, 3)
    b1 = _nonzero(rng, -5, 5)
    s2 = rng.choice([-1, 1])
    a2 = _nonzero(rng, 1, 3)
    b2 = _nonzero(rng, -5, 5)

    # 确保 x 总系数不为 0
    while Fraction(a1, d1) + Fraction(s2 * a2, d2) == 0:
        a2 = _nonzero(rng, 1, 3)

    c_rhs = rng.randint(-4, 4)
    # 算出真实解 x0
    total_a = Fraction(a1, d1) + Fraction(s2 * a2, d2)
    total_c = Fraction(b1, d1) + Fraction(s2 * b2, d2)
    x0 = (Fraction(c_rhs) - total_c) / total_a

    # 控制解的分子分母不要太大，保持初中练习友好度
    if abs(x0.numerator) > 30 or x0.denominator > 12:
        return _gen_l3(rng)

    lhs = [
        _Term(1, a1, b1, den=d1),
        _Term(s2, a2, b2, den=d2),
    ]
    rhs = [_Term(c_rhs, 0, 1)]
    lcm_val = math.lcm(d1, d2)
    hint = f"方程两边先同乘分母的最小公倍数 {lcm_val} 去分母，注意右边的常数项也要乘 {lcm_val}。"
    return lhs, rhs, x0, hint


def _gen_l4(rng: random.Random) -> tuple[list[_Term], list[_Term], Fraction, str]:
    """L4: 综合题（两侧均有分母 + 括号/常数项/一次项）。"""
    d1, d2 = rng.sample([2, 3, 4, 6], 2)
    k1 = rng.choice([1, 2, 3])
    a1 = _nonzero(rng, 1, 2)
    b1 = _nonzero(rng, -4, 4)
    c1 = _nonzero(rng, -3, 3)

    a2 = _nonzero(rng, 1, 3)
    b2 = _nonzero(rng, -4, 4)
    a3 = _nonzero(rng, -2, 2)

    lhs_a = Fraction(k1 * a1, d1)
    lhs_c = Fraction(k1 * b1, d1) + c1
    rhs_a = Fraction(a2, d2) + a3
    rhs_c = Fraction(b2, d2)

    if lhs_a == rhs_a:
        return _gen_l4(rng)

    x0 = (rhs_c - lhs_c) / (lhs_a - rhs_a)
    if abs(x0.numerator) > 30 or x0.denominator > 12:
        return _gen_l4(rng)

    lhs = [
        _Term(k1, a1, b1, den=d1, is_paren=(k1 > 1)),
        _Term(c1, 0, 1),
    ]
    rhs = [
        _Term(1, a2, b2, den=d2),
        _Term(a3, 1, 0),
    ]
    lcm_val = math.lcm(d1, d2)
    hint = f"按「去分母（同乘 {lcm_val}）→ 去括号 → 移项 → 合并同类项 → 系数化为 1」五步依次求解。"
    return lhs, rhs, x0, hint


def generate(level: int, rng: random.Random | None = None) -> Question:
    if level not in (1, 2, 3, 4):
        raise ValueError(f"不支持的难度等级: {level}")
    r = rng or random.Random()

    generators = {1: _gen_l1, 2: _gen_l2, 3: _gen_l3, 4: _gen_l4}
    lhs, rhs, x0, hint = generators[level](r)

    prompt_raw = f"{_fmt_side(lhs, tex=False)} = {_fmt_side(rhs, tex=False)}"
    prompt_tex = f"{_fmt_side(lhs, tex=True)} = {_fmt_side(rhs, tex=True)}"
    ans_val_raw = frac_to_raw(x0)
    ans_val_tex = frac_to_tex(x0)

    steps = _build_steps(lhs, rhs, x0)
    dens = [t.den for t in lhs + rhs if t.den > 1]
    lcm_val = math.lcm(*dens) if dens else 1
    is_frac = x0.denominator > 1 or any(t.den > 1 for t in lhs + rhs)

    return Question(
        topic="equation",
        level=level,
        prompt_raw=prompt_raw,
        prompt_tex=prompt_tex,
        answer_raw=f"x = {ans_val_raw}",
        answer_tex=f"x = {ans_val_tex}",
        hint=hint,
        steps=steps,
        is_fraction=is_frac,
        is_decimal=False,
        meta={
            "solution": ans_val_raw,
            "lhs": [t.to_dict() for t in lhs],
            "rhs": [t.to_dict() for t in rhs],
            "lcm": lcm_val,
        },
    )


# ---------- 判卷逻辑 ----------

def _extract_linear_x(p: Poly) -> tuple[Fraction, Fraction] | None:
    """检查多项式是否仅含 x 且次数 <= 1，返回 (a, b) 表示 a*x + b；否则返回 None。"""
    for k in p:
        if k not in (ZERO_KEY, X_KEY):
            return None
    return p.get(X_KEY, Fraction(0)), p.get(ZERO_KEY, Fraction(0))


def _is_bare_x(node: ExprNode) -> bool:
    return isinstance(node, VarNode) and node.name == "x"


def _is_signed_num(node: ExprNode) -> bool:
    if isinstance(node, NumNode):
        return True
    if isinstance(node, UnaryNode) and isinstance(node.operand, NumNode):
        return True
    return False


def _is_pure_number_node(node: ExprNode) -> bool:
    """判断 AST 是否为单个数字或纯分数（允许分子分母带 +/-），如 3, -3/2, -3/-2, 1.5。"""
    if _is_signed_num(node):
        return True
    if isinstance(node, BinOpNode) and node.op == "/":
        return _is_signed_num(node.left) and _is_signed_num(node.right)
    return False


def _has_unreduced_fraction_in_node(node: ExprNode) -> bool:
    """检查数字节点中是否包含未约分分数（如 6/4 或 4/-2）。"""
    if isinstance(node, NumNode):
        if "/" in node.raw:
            _, unreduced = parse_number_strict(node.raw)
            return unreduced
        return False
    if isinstance(node, UnaryNode):
        return _has_unreduced_fraction_in_node(node.operand)
    if isinstance(node, BinOpNode) and node.op == "/":
        # 处理如 -6/4 或 6/-4 被解析为 BinOpNode('/') 的情况
        if _is_pure_number_node(node.left) and _is_pure_number_node(node.right):
            l_val = expand(node.left).get(ZERO_KEY, Fraction(0))
            r_val = expand(node.right).get(ZERO_KEY, Fraction(0))
            if r_val != 0 and l_val.denominator == 1 and r_val.denominator == 1:
                num, den = l_val.numerator, r_val.numerator
                return math.gcd(abs(num), abs(den)) > 1 or den < 0
    return False


def grade(
    question: Question,
    student_input: str,
    *,
    user_priors: dict[str, float] | None = None,
) -> GradeResult:
    raw = student_input.strip().replace("＝", "=")
    if not raw:
        return GradeResult("error", False, "请输入你的答案。")

    x0 = Fraction(question.meta["solution"])

    # 情况 A：学生输入等式（如 x = -3/2 或 2x = 6）
    if "=" in raw:
        parts = raw.split("=")
        if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
            return GradeResult("error", False, "等式格式不正确，应包含且仅包含一个等号。")
        try:
            l_node = parse_expr(parts[0])
            r_node = parse_expr(parts[1])
            l_poly = expand(l_node)
            r_poly = expand(r_node)
        except (ParseError, ValueError) as e:
            return GradeResult("error", False, f"输入格式有误：{e}")

        student_tex = f"{node_to_tex(l_node)} = {node_to_tex(r_node)}"
        diff = poly_sub(l_poly, r_poly)
        lin = _extract_linear_x(diff)
        if lin is None:
            return GradeResult("error", False, "方程中只应包含未知数 x，且最高次数为 1。", student_tex)

        a, b = lin
        if a == 0:
            return GradeResult("wrong", False, "这不是一个有效的一元一次方程解。", student_tex)

        student_x = -b / a
        if student_x != x0:
            diag = diagnose_equation(question, student_x, user_priors=user_priors)
            return GradeResult(
                "wrong",
                False,
                "答案不正确，请检查移项、去括号或计算过程。",
                student_tex,
                diagnosis=diag,
            )

        # 同解！检查是否已经孤立为 x = <数值> 或 <数值> = x
        val_node: ExprNode | None = None
        if _is_bare_x(l_node) and _is_pure_number_node(r_node):
            val_node = r_node
        elif _is_bare_x(r_node) and _is_pure_number_node(l_node):
            val_node = l_node

        if val_node is None:
            return GradeResult(
                "unisolated",
                False,
                "方程变形正确，但还没解完，请把未知数 x 的系数化为 1（写成 x = 数值）。",
                student_tex,
            )

        if _has_unreduced_fraction_in_node(val_node):
            return GradeResult(
                "unreduced",
                False,
                "结果数值正确，但分数还可以继续约分（分母应为正整数）。",
                student_tex,
            )

        return GradeResult("correct", True, "回答正确！", student_tex)

    # 情况 B：学生直接输入数值（如 -3/2 或 6/4）
    try:
        val, unreduced = parse_number_strict(raw)
        student_tex = frac_to_tex(val)
        if val != x0:
            diag = diagnose_equation(question, val, user_priors=user_priors)
            return GradeResult("wrong", False, "答案不正确，请再算一遍。", student_tex, diagnosis=diag)
        if unreduced:
            return GradeResult(
                "unreduced",
                False,
                "结果数值正确，但分数还可以继续约分。",
                student_tex,
            )
        return GradeResult("correct", True, "回答正确！", student_tex)
    except ValueError:
        pass

    # 兜底：尝试按表达式解析（如学生填了 1+2 或 2x）
    try:
        node = parse_expr(raw)
        poly = expand(node)
        student_tex = node_to_tex(node)
    except (ParseError, ValueError) as e:
        return GradeResult("error", False, f"输入格式有误：{e}")

    # 若含未知数但没有等号，提示格式错
    if any(k != ZERO_KEY for k in poly):
        return GradeResult("error", False, "请直接填写数值，或填写完整等式（如 x = 3）。", student_tex)

    val = poly.get(ZERO_KEY, Fraction(0))
    if val == x0:
        if _has_unreduced_fraction_in_node(node):
            return GradeResult("unreduced", False, "结果数值正确，但分数还可以继续约分。", student_tex)
        return GradeResult("unisolated", False, "数值等价，但请化简为最终的单一数值。", student_tex)
    diag = diagnose_equation(question, val, user_priors=user_priors)
    return GradeResult("wrong", False, "答案不正确，请再算一遍。", student_tex, diagnosis=diag)