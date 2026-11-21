from dataclasses import dataclass, field
from typing import Any, Literal

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
    title: str
    tex: str
    note: str = ""
    note_tex: str = ""


@dataclass(frozen=True)
class Question:
    topic: Topic
    level: int
    prompt_raw: str
    prompt_tex: str
    answer_raw: str
    answer_tex: str
    hint: str
    steps: list[Step]
    is_fraction: bool = False
    is_decimal: bool = False
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class GradeResult:
    result: ResultCode
    is_correct: bool
    feedback: str
    student_tex: str = ""