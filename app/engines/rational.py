from fractions import Fraction
import math
import re

_INT_RE = re.compile(r"^[+-]?\d+$")
_DEC_RE = re.compile(r"^[+-]?(?:\d+\.\d*|\.\d+)$")
_FRAC_RE = re.compile(r"^([+-]?\d+)\s*/\s*([+-]?\d+)$")


def parse_number_strict(text: str) -> tuple[Fraction, bool]:
    """
    解析单个整数、小数或纯分数（如 '3/4', '-6/8', '0.75', '.75'）。
    返回 (Fraction 值, is_unreduced)。
    """
    s = text.strip()
    if not s:
        raise ValueError("空输入")

    if _INT_RE.match(s):
        return Fraction(int(s), 1), False

    if _DEC_RE.match(s):
        return Fraction(s), False

    m = _FRAC_RE.match(s)
    if m:
        num = int(m.group(1))
        den = int(m.group(2))
        if den == 0:
            raise ValueError("分母不能为 0")
        unreduced = (math.gcd(abs(num), abs(den)) > 1) or (den < 0)
        return Fraction(num, den), unreduced

    raise ValueError(f"无法解析数字: {text}")


def frac_to_raw(val: Fraction) -> str:
    if val.denominator == 1:
        return str(val.numerator)
    return f"{val.numerator}/{val.denominator}"


def frac_to_tex(val: Fraction, signed: bool = False) -> str:
    """将 Fraction 转为 KaTeX 字符串，分数统一使用 \\dfrac。"""
    sign = ""
    if val < 0:
        sign = "-"
        val = -val
    elif signed:
        sign = "+"

    if val.denominator == 1:
        return f"{sign}{val.numerator}"
    return f"{sign}\\dfrac{{{val.numerator}}}{{{val.denominator}}}"


def frac_to_decimal_str(val: Fraction) -> str:
    """将有限小数对应的 Fraction 转为不带尾随零的小数字符串（如 96/5 -> '19.2'）。"""
    if val.denominator == 1:
        return str(val.numerator)
    # 检查分母是否只含因子 2 和 5
    d = val.denominator
    twos = fives = 0
    while d % 2 == 0:
        d //= 2
        twos += 1
    while d % 5 == 0:
        d //= 5
        fives += 1
    if d != 1:
        return frac_to_raw(val)

    sign = "-" if val < 0 else ""
    num = abs(val.numerator)
    scale = max(twos, fives)
    scaled = num * (2 ** (scale - twos)) * (5 ** (scale - fives))
    s = str(scaled).rjust(scale + 1, "0")
    int_part, dec_part = s[:-scale], s[-scale:].rstrip("0")
    return f"{sign}{int_part}.{dec_part}" if dec_part else f"{sign}{int_part}"