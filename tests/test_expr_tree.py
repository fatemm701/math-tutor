from fractions import Fraction
import pytest

from app.engines.expr_tree import (
    ParseError,
    expand,
    format_poly,
    has_parentheses,
    has_unmerged_like_terms,
    node_to_tex,
    parse_expr,
)
from app.engines.rational import frac_to_decimal_str, frac_to_tex, parse_number_strict


def test_rational_helpers():
    val, unreduced = parse_number_strict("6/8")
    assert val == Fraction(3, 4) and unreduced is True

    val, unreduced = parse_number_strict("-3/4")
    assert val == Fraction(-3, 4) and unreduced is False

    val, unreduced = parse_number_strict(".75")
    assert val == Fraction(3, 4) and unreduced is False

    assert frac_to_tex(Fraction(-3, 4)) == r"-\dfrac{3}{4}"
    assert frac_to_decimal_str(Fraction(96, 5)) == "19.2"
    assert frac_to_decimal_str(Fraction(4, 2)) == "2"


def test_parse_and_expand_basic():
    p = expand(parse_expr("2(x + 3) - (x - 1)"))
    assert format_poly(p) == "x + 7"

    # 分数系数隐式乘法：1/2x + 3/4
    p2 = expand(parse_expr("1/2x + 3/4 + 1/2x"))
    assert format_poly(p2) == "x + 3/4"
    assert format_poly(p2, tex=True) == r"x + \dfrac{3}{4}"


def test_multivariable_and_powers():
    p = expand(parse_expr("2x² - 3xy + y^2 - (x^2 - xy)"))
    assert format_poly(p) == "x^2 - 2xy + y^2"
    assert format_poly(p, tex=True) == "x^{2} - 2xy + y^{2}"


def test_pedagogical_checks():
    n1 = parse_expr("2(x + 1)")
    assert has_parentheses(n1) is True

    n2 = parse_expr("2x + 3x + 1")
    assert has_parentheses(n2) is False
    assert has_unmerged_like_terms(n2) is True

    n3 = parse_expr("5x + 1")
    assert has_parentheses(n3) is False
    assert has_unmerged_like_terms(n3) is False

    n4 = parse_expr("x + 0")
    assert has_unmerged_like_terms(n4) is True


def test_node_to_tex_and_errors():
    assert node_to_tex(parse_expr("1/2x - 3")) == r"\dfrac{1}{2}x - 3"

    with pytest.raises(ParseError):
        parse_expr("2x + * 3")

    with pytest.raises(ParseError):
        expand(parse_expr("1 / x"))

    with pytest.raises(ParseError):
        parse_expr("1/0")