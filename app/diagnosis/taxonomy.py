from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ErrorSpec:
    code: str
    label: str
    tip: str
    step_name: str


# ---------- 1. 一元一次方程错因体系 ----------

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

# ---------- 2. 整式化简错因体系 ----------

SIMPLIFY_ERROR_SPECS: tuple[ErrorSpec, ...] = (
    ErrorSpec(
        code="simp_paren_sign",
        label="去括号漏变号",
        tip="括号前面是负号时，去掉括号后括号里的每一项都要变号，不能只变第一项。",
        step_name="去括号",
    ),
    ErrorSpec(
        code="simp_omit_mul",
        label="分配律漏乘后项",
        tip="括号外的系数要依次乘以括号内的每一项，不要只乘第一项而漏乘后面的项。",
        step_name="去括号",
    ),
    ErrorSpec(
        code="simp_merge_op",
        label="合并同类项加减符号错",
        tip="合并同类项时，要带着每一项前面的正负号一起把系数相加减。",
        step_name="合并同类项",
    ),
    ErrorSpec(
        code="simp_drop_term",
        label="漏抄或误消某一项",
        tip="去括号后检查每一类字母与次数的项，避免漏抄或不小心漏掉某一项。",
        step_name="合并同类项",
    ),
    ErrorSpec(
        code="simp_mix_unlike",
        label="误合并非同类项",
        tip="只有字母相同且相同字母的次数也完全相同的项才是同类项（如 x²、xy、y²、x 各自独立，不能合并）。",
        step_name="合并同类项",
    ),
    ErrorSpec(
        code="simp_frac_add",
        label="分数系数通分计算错",
        tip="分数系数合并同类项时要先通分，再只把分子相加减，不能分子分母直接相加。",
        step_name="合并同类项",
    ),
    ErrorSpec(
        code="simp_sign_all",
        label="结果整体符号弄反",
        tip="各项系数绝对值都对，但整体符号反了，请重新核对每一项的正负号。",
        step_name="合并同类项",
    ),
    ErrorSpec(
        code="arithmetic_slip",
        label="一般计算失误",
        tip="展开或合并系数的过程中出现了计算偏差，建议对照解析逐步核对。",
        step_name="计算",
    ),
)

# ---------- 3. 口算训练错因体系 ----------

ARITHMETIC_ERROR_SPECS: tuple[ErrorSpec, ...] = (
    ErrorSpec(
        code="arith_order_ops",
        label="运算顺序弄错",
        tip="按「先乘方、再乘除、后加减」计算；乘除同级运算必须从左到右依次进行。",
        step_name="运算顺序",
    ),
    ErrorSpec(
        code="arith_signed_paren",
        label="负数去括号或连减变号错",
        tip="减去一个负数等于加上它的相反数（同号得正、异号得负）；连续减两个数等于减去这两个数的和。",
        step_name="去括号",
    ),
    ErrorSpec(
        code="arith_power_sign",
        label="乘方负号或指数算错",
        tip="注意区分 -a²（先平方再取负）与 (-a)²（底数为负数），同时乘方表示连乘不是底数乘指数。",
        step_name="先算乘方",
    ),
    ErrorSpec(
        code="arith_frac_div_no_inv",
        label="分数除法忘乘倒数",
        tip="除以一个非零分数等于乘以它的倒数，不能直接把两个分数相乘或颠倒被除数。",
        step_name="除法变乘法",
    ),
    ErrorSpec(
        code="arith_frac_add_raw",
        label="分数加减未正确通分",
        tip="异分母分数加减必须先通分（分子分母同乘对应倍数），不能直接把分子分母各自相加减。",
        step_name="通分",
    ),
    ErrorSpec(
        code="arith_decimal_place",
        label="小数点位或进退位出错",
        tip="小数加减要注意小数点对齐与进退位；小数乘法凑整（如 0.25×4=1、1.25×8=10）时注意小数点位数。",
        step_name="小数计算",
    ),
    ErrorSpec(
        code="arith_dist_omit",
        label="乘法分配律漏乘或漏项",
        tip="用乘法分配律展开或逆用提取公因数时，每一项都要配对乘到，不能漏乘括号里的项。",
        step_name="乘法分配律",
    ),
    ErrorSpec(
        code="arith_sign_flip",
        label="最终符号弄反",
        tip="数值大小算对了，但最终结果的正负号弄反了，请检查负因数个数或异号相减的符号。",
        step_name="确定符号",
    ),
    ErrorSpec(
        code="arithmetic_slip",
        label="一般计算失误",
        tip="计算过程中出现了数值偏差，建议对照解析重新验算一遍。",
        step_name="计算",
    ),
)

# 兼容与索引常量
EQUATION_BUG_CODES: tuple[str, ...] = tuple(
    s.code for s in EQUATION_ERROR_SPECS if s.code != "arithmetic_slip"
)
EQUATION_ALL_CODES: tuple[str, ...] = tuple(s.code for s in EQUATION_ERROR_SPECS)
EQUATION_SPEC_BY_CODE: dict[str, ErrorSpec] = {s.code: s for s in EQUATION_ERROR_SPECS}

SIMPLIFY_BUG_CODES: tuple[str, ...] = tuple(
    s.code for s in SIMPLIFY_ERROR_SPECS if s.code != "arithmetic_slip"
)
SIMPLIFY_ALL_CODES: tuple[str, ...] = tuple(s.code for s in SIMPLIFY_ERROR_SPECS)
SIMPLIFY_SPEC_BY_CODE: dict[str, ErrorSpec] = {s.code: s for s in SIMPLIFY_ERROR_SPECS}

ARITHMETIC_BUG_CODES: tuple[str, ...] = tuple(
    s.code for s in ARITHMETIC_ERROR_SPECS if s.code != "arithmetic_slip"
)
ARITHMETIC_ALL_CODES: tuple[str, ...] = tuple(s.code for s in ARITHMETIC_ERROR_SPECS)
ARITHMETIC_SPEC_BY_CODE: dict[str, ErrorSpec] = {s.code: s for s in ARITHMETIC_ERROR_SPECS}

SPECS_BY_TOPIC: dict[str, tuple[ErrorSpec, ...]] = {
    "equation": EQUATION_ERROR_SPECS,
    "simplify": SIMPLIFY_ERROR_SPECS,
    "arithmetic": ARITHMETIC_ERROR_SPECS,
}

BUG_CODES_BY_TOPIC: dict[str, tuple[str, ...]] = {
    "equation": EQUATION_BUG_CODES,
    "simplify": SIMPLIFY_BUG_CODES,
    "arithmetic": ARITHMETIC_BUG_CODES,
}

ALL_SPEC_BY_CODE: dict[str, ErrorSpec] = {}
for _specs in SPECS_BY_TOPIC.values():
    for _s in _specs:
        ALL_SPEC_BY_CODE.setdefault(_s.code, _s)

# 第 1 次答错未锁题时需要模糊化防剧透的“纯反号”错因码
SIGN_SPOILER_CODES: frozenset[str] = frozenset(
    {"sign_flip", "simp_sign_all", "arith_sign_flip"}
)


def get_bug_codes_for_topic(topic: str) -> tuple[str, ...]:
    return BUG_CODES_BY_TOPIC.get(topic, ())


def get_diagnosis_label(code: str | None) -> str:
    if not code:
        return ""
    spec = ALL_SPEC_BY_CODE.get(code)
    return spec.label if spec else code
