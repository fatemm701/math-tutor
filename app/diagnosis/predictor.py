from __future__ import annotations

from fractions import Fraction
from pathlib import Path
from typing import Any

from app.diagnosis.equation_features import FEATURE_NAMES, extract_features_from_meta
from app.diagnosis.equation_sim import BugCandidate
from app.diagnosis.taxonomy import EQUATION_SPEC_BY_CODE
from app.diagnosis.tree_infer import PureTreeModel
from app.engines.types import DiagnosisAlternative, DiagnosisResult, Question

DEFAULT_EQUATION_MODEL_PATH = Path(__file__).resolve().parent / "models" / "equation_gbdt.json"
DEFAULT_MIN_CONFIDENCE = 0.45

_cached_model: PureTreeModel | None = None
_cached_model_path: Path | None = None


def load_equation_model(path: Path | None = None, force_reload: bool = False) -> PureTreeModel | None:
    """懒加载并缓存纯 Python 树模型；模型文件尚未训练导出时安全返回 None。"""
    global _cached_model, _cached_model_path
    target = path or DEFAULT_EQUATION_MODEL_PATH
    if not force_reload and _cached_model is not None and _cached_model_path == target:
        return _cached_model
    if not target.exists():
        return None
    model = PureTreeModel.load(target)
    if tuple(model.feature_names) != FEATURE_NAMES:
        raise ValueError("已导出的模型特征顺序与当前代码不一致，请重新运行训练脚本导出模型。")
    _cached_model = model
    _cached_model_path = target
    return model


def _blend_user_priors(
    probs: dict[str, float],
    user_priors: dict[str, float] | None,
    alpha: float = 0.25,
) -> dict[str, float]:
    """用学生历史错因先验做温和贝叶斯重加权（主要用于多错因碰撞消歧）。"""
    if not user_priors:
        return probs
    k = len(probs)
    uniform = 1.0 / k
    weighted: dict[str, float] = {}
    total = 0.0
    for code, p in probs.items():
        # arithmetic_slip 保持中性先验，避免历史先验过度压制兜底类
        if code == "arithmetic_slip":
            prior = uniform
        else:
            prior = max(0.02, float(user_priors.get(code, uniform)))
        val = p * (prior ** alpha)
        weighted[code] = val
        total += val
    if total <= 0.0:
        return probs
    return {c: v / total for c, v in weighted.items()}


def _pick_detail(
    code: str,
    student_x: Fraction,
    candidates: dict[str, list[BugCandidate]],
) -> str:
    spec = EQUATION_SPEC_BY_CODE[code]
    cands = candidates.get(code, [])
    if not cands:
        return spec.tip

    # 1. 精确命中某个模拟候选
    for c in cands:
        if c.value == student_x:
            return c.detail

    # 2. 命中反号候选（主错因 + 符号翻折）
    for c in cands:
        if c.value != 0 and -c.value == student_x:
            return f"{c.detail}（并且最后结果的正负号可能也弄反了）"

    # 3. 近似命中（主错因 + 轻微算术偏差）
    closest = min(cands, key=lambda c: abs(student_x - c.value))
    return f"思路最接近：{closest.detail}"


def diagnose_equation(
    question: Question,
    student_x: Fraction,
    *,
    user_priors: dict[str, float] | None = None,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
    model_path: Path | None = None,
) -> DiagnosisResult | None:
    """
    结合「符号错因模拟特征 + 训练好的 GBDT/RF 树模型」推测一元一次方程错因。
    若题目缺少结构 meta、模型未导出、或置信度不足 / 判为一般计算失误，则返回 None。
    """
    if question.topic != "equation":
        return None
    extracted = extract_features_from_meta(question.meta, question.level, student_x)
    if extracted is None:
        return None
    features, candidates, _ = extracted

    model = load_equation_model(model_path)
    if model is None:
        return None

    probs = model.predict_proba(features)
    probs = _blend_user_priors(probs, user_priors)

    ranked = sorted(probs.items(), key=lambda kv: kv[1], reverse=True)
    if not ranked:
        return None

    best_code, best_prob = ranked[0]
    if best_code == "arithmetic_slip" or best_prob < min_confidence:
        return None

    spec = EQUATION_SPEC_BY_CODE.get(best_code)
    if spec is None:
        return None

    alternatives = [
        DiagnosisAlternative(
            code=c,
            label=EQUATION_SPEC_BY_CODE[c].label,
            confidence=round(p, 3),
        )
        for c, p in ranked[1:3]
        if c != "arithmetic_slip" and c in EQUATION_SPEC_BY_CODE and p >= 0.12
    ]

    detail = _pick_detail(best_code, student_x, candidates)
    return DiagnosisResult(
        code=best_code,
        label=spec.label,
        tip=spec.tip,
        detail=detail,
        confidence=round(best_prob, 3),
        alternatives=alternatives,
    )


def diagnosis_to_dict(
    diag: DiagnosisResult | None,
    log_id: int | None = None,
    *,
    allow_spoiler: bool = True,
) -> dict[str, Any] | None:
    if diag is None:
        return None
    label = diag.label
    detail = diag.detail
    # 第 1 次答错未锁题时，对 sign_flip 做模糊化防剧透，避免学生不重算直接加负号过关
    if not allow_spoiler and diag.code == "sign_flip":
        label = "正负号可能有误"
        detail = "请重点复查计算过程中的正负号处理（特别是负号去括号、移项和最后一步异号相除）。"
    return {
        "logId": log_id,
        "code": diag.code,
        "label": label,
        "tip": diag.tip,
        "detail": detail,
        "confidence": diag.confidence,
        "alternatives": [
            {"code": a.code, "label": a.label, "confidence": a.confidence}
            for a in diag.alternatives
        ],
    }
