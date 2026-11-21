from dataclasses import dataclass, field
from typing import Literal

Topic = Literal["simplify", "equation", "arithmetic"]
ResultCode = Literal[
    "correct",      # 完全正确
    "wrong",        # 数值/代数不等价
    "parentheses",  # 等价但未去括号（化简）
    "unmerged",     # 等价但未合并同类项（化简）
    "unisolated",   # 同解但未化系数为一，如 2x=8（方程）
    "unreduced",    # 结果正确但分数未约分（方程/口算）
    "error",        # 语法/格式错误
]

@dataclass(frozen=True)
class Step:
    title: str              # 步骤标题，如「去分母」「合并同类项」
    tex: str                # 该步算式的 KaTeX 字符串
    note: str = ""          # 中文讲解
    note_tex: str = ""      # 讲解中含算式/乘方/分数时的 KaTeX 片段（移动端竖排用）

@dataclass(frozen=True)
class Question:
    topic: Topic
    level: int              # 1..4
    prompt_raw: str         # 纯文本题面（存档用）
    prompt_tex: str         # KaTeX 题面（渲染用）
    answer_raw: str         # 标准答案纯文本（存档/比对用）
    answer_tex: str         # 标准答案 KaTeX
    hint: str               # 按题面结构生成的提示语
    steps: list[Step]       # 完整分步解析
    is_fraction: bool = False
    is_decimal: bool = False
    meta: dict = field(default_factory=dict)  # 引擎内部判题所需的只读数据

@dataclass(frozen=True)
class GradeResult:
    result: ResultCode
    is_correct: bool        # 是否判对（注意：口算 unreduced 判对但给提示；方程 unreduced/unisolated 判未完成）
    feedback: str           # 给学生的单行反馈
    student_tex: str = ""   # 学生答案的 KaTeX 渲染（用于对照）

# 每个引擎模块必须暴露：
# def generate(level: int, rng: random.Random | None = None) -> Question
# def grade(question: Question, student_input: str) -> GradeResult