from __future__ import annotations

from fractions import Fraction
from pathlib import Path
from typing import Any

from app.diagnosis.arithmetic_features import (
    ARITHMETIC_FEATURE_NAMES,
    extract_arithmetic_features_from_meta,
)
from app.diagnosis.arithmetic_sim import ArithmeticBugCandidate
from app.diagnosis.equation_features import (
    FEATURE_NAMES as EQUATION_FEATURE_NAMES,
    extract_features_from_meta as extract_equation_features_from_meta,
)
from app.diagnosis.equation_sim import BugCandidate as EquationBugCandidate
from app.diagnosis.simplify_features import (
    SIMPLIFY_FEATURE_NAMES,
    extract_simplify_features_from_meta,
)
from app.diagnosis.simplify_sim import SimplifyBugCandidate
from app.diagnosis.taxonomy import (
    ALL_SPEC_BY_CODE,
    SIGN_SPOILER_CODES,
)
from app.diagnosis.tree_infer import PureTreeModel
from app.engines.expr_tree import Poly, poly_clean, poly_neg
from app.engines.types import DiagnosisAlternative, DiagnosisResult, Question

MODELS_DIR = Path(__file__).resolve().parent / "models"
DEFAULT_EQUATION_MODEL_PATH = MODELS_DIR / "equation_gbdt.json"
DEFAULT_SIMPLIFY_MODEL_PATH = MODELS_DIR / "simplify_gbdt.json"
DEFAULT_ARITHMETIC_MODEL_PATH = MODELS_DIR / "arithmetic_gbdt.json"

DEFAULT_MODEL_PATHS: dict[str, Path] = {
    "equation": DEFAULT_EQUATION_MODEL_PATH,
    "simplify": DEFAULT_SIMPLIFY_MODEL_PATH,
    "arithmetic": DEFAULT_ARITHMETIC_MODEL_PATH,
}

FEATURE_NAMES_BY_TOPIC: dict[str, tuple[str, ...]] = {
    "equation": EQUATION_FEATURE_NAMES,
    "simplify": SIMPLIFY_FEATURE_NAMES,
    "arithmetic": ARITHMETIC_FEATURE_NAMES,
}

DEFAULT_MIN_CONFIDENCE = 0.45

_cached_models: dict[tuple[str, Path], PureTreeModel] = {}


def load_topic_model(
    topic: str,
    path: Path | None = None,
    force_reload: bool = False,
) -> PureTreeModel | None:
    """按题型懒加载并缓存纯 Python 树模型；模型文件尚未导出时安全返回 None。"""
    target = path or DEFAULT_MODEL_PATHS.get(topic)
    if target is None:
        return None
    cache_key = (topic, target)
    if not force_reload and cache_key in _cached_models:
        return _cached_models[cache_key]
    if not target.exists():
        return None
    model = PureTreeModel.load(target)
    expected_feats = FEATURE_NAMES_BY_TOPIC[topic]
    if tuple(model.feature_names) != expected_feats:
        raise ValueError(f"{topic} 模型特征顺序与当前代码不一致，请重新运行训练脚本导出。")
    _cached_models[cache_key] = model
    return model


def load_equation_model(path: Path | None = None, force_reload: bool = False) -> PureTreeModel | None:
    return load_topic_model("equation", path=path, force_reload=force_reload)


def load_simplify_model(path: Path | None = None, force_reload: bool = False) -> PureTreeModel | None:
    return load_topic_model("simplify", path=path, force_reload=force_reload)


def load_arithmetic_model(path: Path | None = None, force_reload: bool = False) -> PureTreeModel | None:
    return load_topic_model("arithmetic", path=path, force_reload=force_reload)


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


def _pick_scalar_detail(
    code: str,
    student_val: Fraction,
    candidates: dict[str, list[EquationBugCandidate]] | dict[str, list[ArithmeticBugCandidate]],
) -> str:
    spec = ALL_SPEC_BY_CODE[code]
    cands = candidates.get(code, [])
    if not cands:
        return spec.tip

    for c in cands:
        if c.value == student_val:
            return c.detail

    for c in cands:
        if c.value != 0 and -c.value == student_val:
            return f"{c.detail}（并且最后结果的正负号可能也弄反了）"

    closest = min(cands, key=lambda c: abs(student_val - c.value))
    return f"思路最接近：{closest.detail}"


def _pick_poly_detail(
    code: str,
    student_poly: Poly,
    candidates: dict[str, list[SimplifyBugCandidate]],
) -> str:
    spec = ALL_SPEC_BY_CODE[code]
    cands = candidates.get(code, [])
    if not cands:
        return spec.tip

    clean_stu = poly_clean(student_poly)
    for c in cands:
        if c.poly == clean_stu:
            return c.detail

    neg_stu = poly_neg(clean_stu)
    for c in cands:
        if c.poly and c.poly == neg_stu:
            return f"{c.detail}（并且整体正负号可能也多反了一次）"

    def _l1(p1: Poly, p2: Poly) -> Fraction:
        keys = set(p1.keys()) | set(p2.keys())
        return sum((abs(p1.get(k, Fraction(0)) - p2.get(k, Fraction(0))) for k in keys), Fraction(0))

    closest = min(cands, key=lambda c: _l1(clean_stu, c.poly))
    return f"思路最接近：{closest.detail}"


def _build_result_from_probs(
    probs: dict[str, float],
    *,
    user_priors: dict[str, float] | None,
    min_confidence: float,
    detail_fn,
) -> DiagnosisResult | None:
    blended = _blend_user_priors(probs, user_priors)
    ranked = sorted(blended.items(), key=lambda kv: kv[1], reverse=True)
    if not ranked:
        return None

    best_code, best_prob = ranked[0]
    if best_code == "arithmetic_slip" or best_prob < min_confidence:
        return None

    spec = ALL_SPEC_BY_CODE.get(best_code)
    if spec is None:
        return None

    alternatives = [
        DiagnosisAlternative(
            code=c,
            label=ALL_SPEC_BY_CODE[c].label,
            confidence=round(p, 3),
        )
        for c, p in ranked[1:3]
        if c != "arithmetic_slip" and c in ALL_SPEC_BY_CODE and p >= 0.12
    ]

    return DiagnosisResult(
        code=best_code,
        label=spec.label,
        tip=spec.tip,
        detail=detail_fn(best_code),
        confidence=round(best_prob, 3),
        alternatives=alternatives,
    )


def diagnose_equation(
    question: Question,
    student_x: Fraction,
    *,
    user_priors: dict[str, float] | None = None,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
    model_path: Path | None = None,
) -> DiagnosisResult | None:
    if question.topic != "equation":
        return None
    extracted = extract_equation_features_from_meta(question.meta, question.level, student_x)
    if extracted is None:
        return None
    features, candidates, _ = extracted
    model = load_topic_model("equation", path=model_path)
    if model is None:
        return None
    probs = model.predict_proba(features)
    return _build_result_from_probs(
        probs,
        user_priors=user_priors,
        min_confidence=min_confidence,
        detail_fn=lambda code: _pick_scalar_detail(code, student_x, candidates),
    )


def diagnose_simplify(
    question: Question,
    student_poly: Poly,
    *,
    user_priors: dict[str, float] | None = None,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
    model_path: Path | None = None,
) -> DiagnosisResult | None:
    if question.topic != "simplify":
        return None
    extracted = extract_simplify_features_from_meta(question.meta, question.level, student_poly)
    if extracted is None:
        return None
    features, candidates, _ = extracted
    model = load_topic_model("simplify", path=model_path)
    if model is None:
        return None
    probs = model.predict_proba(features)
    return _build_result_from_probs(
        probs,
        user_priors=user_priors,
        min_confidence=min_confidence,
        detail_fn=lambda code: _pick_poly_detail(code, student_poly, candidates),
    )


def diagnose_arithmetic(
    question: Question,
    student_val: Fraction,
    *,
    user_priors: dict[str, float] | None = None,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
    model_path: Path | None = None,
) -> DiagnosisResult | None:
    if question.topic != "arithmetic":
        return None
    extracted = extract_arithmetic_features_from_meta(question.meta, question.level, student_val)
    if extracted is None:
        return None
    features, candidates, _ = extracted
    model = load_topic_model("arithmetic", path=model_path)
    if model is None:
        return None
    probs = model.predict_proba(features)
    return _build_result_from_probs(
        probs,
        user_priors=user_priors,
        min_confidence=min_confidence,
        detail_fn=lambda code: _pick_scalar_detail(code, student_val, candidates),
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
    # 第 1 次答错未锁题时，对纯反号类错因做模糊化防剧透，避免学生不重算直接加负号过关
    if not allow_spoiler and diag.code in SIGN_SPOILER_CODES:
        label = "正负号可能有误"
        detail = "请重点复查计算过程中的正负号处理（如负号去括号、移项或异号乘除的符号）。"
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
