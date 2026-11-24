from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ErrorSpec:
    code: str
    label: str
    tip: str
    step_name: str


# 一元一次方程错因分类体系（顺序固定，与模型类别对齐）
EQUATION_ERROR_SPECS: tuple[ErrorSpec, ...] = (
    ErrorSpec(
        code="denom_omit_const",
        label="去分母漏乘整数项",
        tip="去分母时方程两边的每一项都要同乘最小公倍数，不含分母的常数项和一次项不能漏乘。",
        step_name="去分母",
    ),
    ErrorSpec(
        code="denom_mul_error",
        label="去分母倍数算错",
        tip="去分母时每个分式的分子应乘「最小公倍数 ÷ 原分母」，不能直接去掉分母或把倍数弄反。",
        step_name="去分母",
    ),
    ErrorSpec(
        code="paren_sign",
        label="去括号漏变号",
        tip="括号前是负号时，去掉括号后括号里的每一项都要变成相反数。",
        step_name="去括号",
    ),
    ErrorSpec(
        code="paren_omit_mul",
        label="去括号漏乘后项",
        tip="用乘法分配律去括号时，括号外的系数要分别乘到括号里面的每一项，不能只乘第一项。",
        step_name="去括号",
    ),
    ErrorSpec(
        code="transpose_sign",
        label="移项忘记变号",
        tip="把项从等号一边移到另一边时，正号要变负号、负号要变正号。",
        step_name="移项",
    ),
    ErrorSpec(
        code="coeff_invert",
        label="系数化为1分子分母颠倒",
        tip="化为 ax = b 后，两边应同除以未知数系数 a（得 x = b/a），注意不要除反成 a/b。",
        step_name="系数化为 1",
    ),
    ErrorSpec(
        code="coeff_sub_div",
        label="系数化为1误用加减",
        tip="化为 ax = b 后，要把系数 a 化为 1 需要两边同除以 a，不能把 a 移到右边做加减或漏除。",
        step_name="系数化为 1",
    ),
    ErrorSpec(
        code="sign_flip",
        label="最终符号弄反",
        tip="数值大小算对了，但最终结果的正负号弄反了，请检查最后一步除法的符号（同号得正，异号得负）。",
        step_name="系数化为 1",
    ),
    ErrorSpec(
        code="arithmetic_slip",
        label="一般计算失误",
        tip="计算过程中出现了数值或复合偏差，建议对照下方解析一步步核对。",
        step_name="计算",
    ),
)

EQUATION_BUG_CODES: tuple[str, ...] = tuple(
    s.code for s in EQUATION_ERROR_SPECS if s.code != "arithmetic_slip"
)
EQUATION_ALL_CODES: tuple[str, ...] = tuple(s.code for s in EQUATION_ERROR_SPECS)
EQUATION_SPEC_BY_CODE: dict[str, ErrorSpec] = {s.code: s for s in EQUATION_ERROR_SPECS}


def get_diagnosis_label(code: str | None) -> str:
    if not code:
        return ""
    spec = EQUATION_SPEC_BY_CODE.get(code)
    return spec.label if spec else code
