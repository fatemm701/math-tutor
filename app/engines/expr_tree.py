from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
import re
from typing import Union

from app.engines.rational import frac_to_raw, frac_to_tex

# 变量顺序与原项目保持一致（a, b 仅兼容旧记录）
VAR_ORDER = ("x", "y", "a", "b")
MonoKey = tuple[int, int, int, int]  # (exp_x, exp_y, exp_a, exp_b)
Poly = dict[MonoKey, Fraction]

ZERO_KEY: MonoKey = (0, 0, 0, 0)


# ---------- 多项式运算 ----------

def poly_clean(p: Poly) -> Poly:
    return {k: v for k, v in p.items() if v != 0}


def poly_const(val: Fraction) -> Poly:
    return {} if val == 0 else {ZERO_KEY: val}


def poly_var(name: str, exp: int = 1) -> Poly:
    idx = VAR_ORDER.index(name)
    key = tuple(exp if i == idx else 0 for i in range(4))
    return {key: Fraction(1)}


def poly_add(a: Poly, b: Poly) -> Poly:
    res = dict(a)
    for k, v in b.items():
        nv = res.get(k, Fraction(0)) + v
        if nv == 0:
            res.pop(k, None)
        else:
            res[k] = nv
    return res


def poly_neg(a: Poly) -> Poly:
    return {k: -v for k, v in a.items()}


def poly_sub(a: Poly, b: Poly) -> Poly:
    return poly_add(a, poly_neg(b))


def poly_mul(a: Poly, b: Poly) -> Poly:
    res: Poly = {}
    for k1, v1 in a.items():
        for k2, v2 in b.items():
            k = (k1[0] + k2[0], k1[1] + k2[1], k1[2] + k2[2], k1[3] + k2[3])
            nv = res.get(k, Fraction(0)) + v1 * v2
            if nv == 0:
                res.pop(k, None)
            else:
                res[k] = nv
    return res


def poly_div_scalar(a: Poly, scalar: Fraction) -> Poly:
    if scalar == 0:
        raise ValueError("除数不能为 0")
    return {k: v / scalar for k, v in a.items()}


def poly_pow(a: Poly, exp: int) -> Poly:
    if exp < 0 or exp > 6:
        raise ValueError("指数超出允许范围 (0~6)")
    res: Poly = {ZERO_KEY: Fraction(1)}
    base = a
    e = exp
    while e > 0:
        if e & 1:
            res = poly_mul(res, base)
        base = poly_mul(base, base)
        e >>= 1
    return res


def _sort_key(k: MonoKey) -> tuple[int, tuple[int, ...]]:
    # 先按总次数降序，再按 x, y, a, b 次数降序
    return (-sum(k), tuple(-e for e in k))


def format_mono_vars(k: MonoKey, tex: bool = False) -> str:
    parts: list[str] = []
    for var, exp in zip(VAR_ORDER, k):
        if exp == 0:
            continue
        if exp == 1:
            parts.append(var)
        else:
            parts.append(f"{var}^{{{exp}}}" if tex else f"{var}^{exp}")
    return "".join(parts)


def format_poly(p: Poly, tex: bool = False) -> str:
    p = poly_clean(p)
    if not p:
        return "0"
    keys = sorted(p.keys(), key=_sort_key)
    out: list[str] = []
    for i, k in enumerate(keys):
        coeff = p[k]
        vars_str = format_mono_vars(k, tex=tex)
        neg = coeff < 0
        abs_c = -coeff if neg else coeff

        if i == 0:
            prefix = "-" if neg else ""
        else:
            prefix = " - " if neg else " + "

        if not vars_str:
            body = frac_to_tex(abs_c) if tex else frac_to_raw(abs_c)
        elif abs_c == 1:
            body = vars_str
        else:
            c_str = frac_to_tex(abs_c) if tex else frac_to_raw(abs_c)
            body = f"{c_str}{vars_str}"

        out.append(f"{prefix}{body}")
    return "".join(out)


# ---------- AST 节点 ----------

@dataclass(frozen=True)
class NumNode:
    value: Fraction
    raw: str = ""


@dataclass(frozen=True)
class VarNode:
    name: str


@dataclass(frozen=True)
class UnaryNode:
    op: str  # '+' | '-'
    operand: ExprNode


@dataclass(frozen=True)
class BinOpNode:
    op: str  # '+' | '-' | '*' | '/' | '^'
    left: ExprNode
    right: ExprNode


@dataclass(frozen=True)
class ParenNode:
    inner: ExprNode


ExprNode = Union[NumNode, VarNode, UnaryNode, BinOpNode, ParenNode]


# ---------- 词法分析 ----------

_TOKEN_RE = re.compile(
    r"\s*(?:(\d+\.\d*|\.\d+|\d+)|([xyab])|([+\-*/^()])|(.))"
)


class ParseError(ValueError):
    pass


def _tokenize(text: str) -> list[tuple[str, str]]:
    # 兼容中文全角符号与常见乘除号
    s = (
        text.replace("−", "-")
        .replace("－", "-")
        .replace("＋", "+")
        .replace("×", "*")
        .replace("·", "*")
        .replace("÷", "/")
        .replace("（", "(")
        .replace("）", ")")
        .replace("²", "^2")
        .replace("³", "^3")
        .strip()
    )
    if not s:
        raise ParseError("输入不能为空")

    tokens: list[tuple[str, str]] = []
    for m in _TOKEN_RE.finditer(s):
        num, var, op, bad = m.groups()
        if num is not None:
            tokens.append(("NUM", num))
        elif var is not None:
            tokens.append(("VAR", var))
        elif op is not None:
            tokens.append((op, op))
        elif bad is not None:
            raise ParseError(f"包含非法字符: {bad}")
    return tokens


# ---------- 递归下降解析器 ----------

class _Parser:
    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self.tokens = tokens
        self.pos = 0

    def peek(self) -> tuple[str, str] | None:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def consume(self, expected: str | None = None) -> tuple[str, str]:
        tok = self.peek()
        if tok is None:
            raise ParseError("表达式不完整")
        if expected and tok[0] != expected:
            raise ParseError(f"期望 '{expected}'，但遇到 '{tok[1]}'")
        self.pos += 1
        return tok

    def parse(self) -> ExprNode:
        node = self.parse_add()
        if self.peek() is not None:
            raise ParseError(f"多余的符号: {self.peek()[1]}")
        return node

    def parse_add(self) -> ExprNode:
        node = self.parse_mul()
        while (tok := self.peek()) and tok[0] in ("+", "-"):
            self.consume()
            right = self.parse_mul()
            node = BinOpNode(tok[0], node, right)
        return node

    def parse_mul(self) -> ExprNode:
        node = self.parse_unary()
        while (tok := self.peek()) is not None:
            if tok[0] in ("*", "/"):
                self.consume()
                right = self.parse_unary()
                node = BinOpNode(tok[0], node, right)
            elif tok[0] in ("VAR", "("):
                # 隐式乘法：如 2x, xy, 1/2x, 2(x+1), (x+1)(x-1)
                right = self.parse_power()
                node = BinOpNode("*", node, right)
            else:
                break
        return node

    def parse_unary(self) -> ExprNode:
        tok = self.peek()
        if tok and tok[0] in ("+", "-"):
            self.consume()
            return UnaryNode(tok[0], self.parse_unary())
        return self.parse_power()

    def parse_power(self) -> ExprNode:
        node = self.parse_atom()
        if (tok := self.peek()) and tok[0] == "^":
            self.consume()
            exp = self.parse_unary()
            return BinOpNode("^", node, exp)
        return node

    def parse_atom(self) -> ExprNode:
        tok = self.peek()
        if tok is None:
            raise ParseError("表达式意外结束")
        if tok[0] == "NUM":
            self.consume()
            # 特殊规则：数字后紧跟 '/' 和数字（如 1/2x），优先绑定为有理数系数
            if (
                self.pos + 1 < len(self.tokens)
                and self.tokens[self.pos][0] == "/"
                and self.tokens[self.pos + 1][0] == "NUM"
            ):
                self.consume("/")
                den_tok = self.consume("NUM")
                num_val = Fraction(tok[1])
                den_val = Fraction(den_tok[1])
                if den_val == 0:
                    raise ParseError("分母不能为 0")
                return NumNode(num_val / den_val, raw=f"{tok[1]}/{den_tok[1]}")
            return NumNode(Fraction(tok[1]), raw=tok[1])
        if tok[0] == "VAR":
            self.consume()
            return VarNode(tok[1])
        if tok[0] == "(":
            self.consume("(")
            inner = self.parse_add()
            self.consume(")")
            return ParenNode(inner)
        raise ParseError(f"无法识别的符号: {tok[1]}")


def parse_expr(text: str) -> ExprNode:
    return _Parser(_tokenize(text)).parse()


# ---------- 展开、结构检查与渲染 ----------

def expand(node: ExprNode) -> Poly:
    if isinstance(node, NumNode):
        return poly_const(node.value)
    if isinstance(node, VarNode):
        return poly_var(node.name)
    if isinstance(node, ParenNode):
        return expand(node.inner)
    if isinstance(node, UnaryNode):
        p = expand(node.operand)
        return p if node.op == "+" else poly_neg(p)
    if isinstance(node, BinOpNode):
        left = expand(node.left)
        right = expand(node.right)
        if node.op == "+":
            return poly_add(left, right)
        if node.op == "-":
            return poly_sub(left, right)
        if node.op == "*":
            return poly_mul(left, right)
        if node.op == "/":
            # 仅允许除以非零常数（整式/一元一次方程范围内）
            if len(right) != 1 or ZERO_KEY not in right:
                raise ParseError("分母不能包含未知数")
            return poly_div_scalar(left, right[ZERO_KEY])
        if node.op == "^":
            if len(right) != 1 or ZERO_KEY not in right:
                raise ParseError("指数必须是整数")
            exp_val = right[ZERO_KEY]
            if exp_val.denominator != 1:
                raise ParseError("指数必须是整数")
            return poly_pow(left, int(exp_val))
    raise ParseError("未知节点类型")


def has_parentheses(node: ExprNode) -> bool:
    if isinstance(node, ParenNode):
        return True
    if isinstance(node, UnaryNode):
        return has_parentheses(node.operand)
    if isinstance(node, BinOpNode):
        return has_parentheses(node.left) or has_parentheses(node.right)
    return False


def _collect_additive_terms(node: ExprNode) -> list[ExprNode]:
    if isinstance(node, BinOpNode) and node.op in ("+", "-"):
        return _collect_additive_terms(node.left) + _collect_additive_terms(node.right)
    return [node]


def has_unmerged_like_terms(node: ExprNode) -> bool:
    """在无括号前提下，检查是否存在未合并的同类项或多余的 0 项（如 2x + 3x 或 x + 0）。"""
    terms = _collect_additive_terms(node)
    if len(terms) <= 1:
        return False
    seen_keys: set[MonoKey] = set()
    for t in terms:
        p = expand(t)
        if not p:
            return True  # 多余的 0 项，如 x + 0 或 2x - 2x
        if len(p) > 1:
            return True
        k = next(iter(p.keys()))
        if k in seen_keys:
            return True
        seen_keys.add(k)
    return False


def node_to_tex(node: ExprNode) -> str:
    """将 AST 渲染为 KaTeX 字符串（用于展示学生原始输入）。"""
    if isinstance(node, NumNode):
        return frac_to_tex(node.value)
    if isinstance(node, VarNode):
        return node.name
    if isinstance(node, ParenNode):
        return f"\\left({node_to_tex(node.inner)}\\right)"
    if isinstance(node, UnaryNode):
        return f"{node.op}{node_to_tex(node.operand)}"
    if isinstance(node, BinOpNode):
        if node.op in ("+", "-"):
            return f"{node_to_tex(node.left)} {node.op} {node_to_tex(node.right)}"
        if node.op == "*":
            l_tex = node_to_tex(node.left)
            r_tex = node_to_tex(node.right)
            # 数字乘数字时显式加 \times，否则省略乘号
            if isinstance(node.left, NumNode) and isinstance(node.right, NumNode):
                return f"{l_tex} \\times {r_tex}"
            return f"{l_tex}{r_tex}"
        if node.op == "/":
            return f"\\dfrac{{{node_to_tex(node.left)}}}{{{node_to_tex(node.right)}}}"
        if node.op == "^":
            return f"{node_to_tex(node.left)}^{{{node_to_tex(node.right)}}}"
    return ""