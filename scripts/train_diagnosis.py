"""
统一离线训练脚本：支持 equation / simplify / arithmetic / all 三个题型的错因诊断树模型（GBDT / RF），
并导出为纯 Python 零依赖推理 JSON。

用法示例：
  uv run --extra ml python scripts/train_diagnosis.py --topic all
  uv run --extra ml python scripts/train_diagnosis.py --topic simplify --model gbdt
  uv run --extra ml python scripts/train_diagnosis.py --topic arithmetic --model rf --max-depth 10
  uv run --extra ml python scripts/train_diagnosis.py --topic all --db data/poly_drill.db --real-weight 5
"""

from __future__ import annotations

import argparse
from collections import Counter
from fractions import Fraction
import json
from pathlib import Path
import random
import sqlite3
import sys
import time
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.diagnosis.arithmetic_features import (  # noqa: E402
    ARITHMETIC_FEATURE_NAMES,
    extract_arithmetic_features_from_analysis,
    extract_arithmetic_features_from_meta,
)
from app.diagnosis.arithmetic_sim import (  # noqa: E402
    analyze_arithmetic_meta,
    generate_synthetic_arithmetic_sample,
)
from app.diagnosis.equation_features import (  # noqa: E402
    FEATURE_NAMES as EQUATION_FEATURE_NAMES,
    extract_features_from_analysis as extract_eq_features,
    extract_features_from_meta as extract_eq_features_from_meta,
)
from app.diagnosis.equation_sim import (  # noqa: E402
    analyze_equation_meta,
    generate_synthetic_wrong_sample as gen_eq_sample,
)
from app.diagnosis.predictor import DEFAULT_MODEL_PATHS  # noqa: E402
from app.diagnosis.simplify_features import (  # noqa: E402
    SIMPLIFY_FEATURE_NAMES,
    extract_simplify_features_from_analysis,
    extract_simplify_features_from_meta,
)
from app.diagnosis.simplify_sim import (  # noqa: E402
    analyze_simplify_meta,
    generate_synthetic_simplify_sample,
)
from app.diagnosis.taxonomy import (  # noqa: E402
    ALL_SPEC_BY_CODE,
    ARITHMETIC_ALL_CODES,
    EQUATION_ALL_CODES,
    SIMPLIFY_ALL_CODES,
)
from app.diagnosis.tree_infer import PureTreeModel  # noqa: E402
from app.engines import arithmetic, equation, simplify  # noqa: E402
from app.engines.expr_tree import ZERO_KEY, expand, parse_expr, poly_sub  # noqa: E402
from app.engines.rational import parse_number_strict  # noqa: E402


def _parse_equation_x(raw: str) -> Fraction | None:
    s = raw.strip().replace("＝", "=")
    if not s:
        return None
    if "=" in s:
        parts = s.split("=")
        if len(parts) != 2:
            return None
        try:
            diff = poly_sub(expand(parse_expr(parts[0])), expand(parse_expr(parts[1])))
        except Exception:
            return None
        a = diff.get((1, 0, 0, 0), Fraction(0))
        b = diff.get(ZERO_KEY, Fraction(0))
        if a == 0:
            return None
        return -b / a
    try:
        val, _ = parse_number_strict(s)
        return val
    except Exception:
        return None


def _parse_simplify_poly(raw: str):
    s = raw.strip()
    if not s or "=" in s:
        return None
    try:
        return expand(parse_expr(s))
    except Exception:
        return None


def _parse_arithmetic_val(raw: str) -> Fraction | None:
    s = raw.strip().replace("−", "-").replace("－", "-").replace("＋", "+")
    if not s:
        return None
    try:
        val, _ = parse_number_strict(s)
        return val
    except Exception:
        return None


def _load_real_feedback_samples(
    topic: str,
    db_path: Path,
    valid_codes: set[str],
) -> tuple[list[list[float]], list[str]]:
    if not db_path.exists():
        return [], []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        tables = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "diagnosis_logs" not in tables:
            return [], []
        rows = conn.execute(
            """
            SELECT level, student_answer, meta_json, predicted_code
            FROM diagnosis_logs
            WHERE topic = ? AND feedback = 1
            """,
            (topic,),
        ).fetchall()
    finally:
        conn.close()

    xs: list[list[float]] = []
    ys: list[str] = []
    for r in rows:
        code = r["predicted_code"]
        if code not in valid_codes:
            continue
        try:
            meta = json.loads(r["meta_json"])
        except Exception:
            continue
        lvl = int(r["level"])
        if topic == "equation":
            val = _parse_equation_x(r["student_answer"])
            if val is None:
                continue
            ext = extract_eq_features_from_meta(meta, lvl, val)
        elif topic == "simplify":
            poly = _parse_simplify_poly(r["student_answer"])
            if poly is None:
                continue
            ext = extract_simplify_features_from_meta(meta, lvl, poly)
        else:
            val = _parse_arithmetic_val(r["student_answer"])
            if val is None:
                continue
            ext = extract_arithmetic_features_from_meta(meta, lvl, val)
        if ext is None:
            continue
        xs.append(ext[0])
        ys.append(code)
    return xs, ys


def _generate_dataset_for_topic(
    topic: str,
    samples_per_level: int,
    noisy_prob: float,
    slip_prob: float,
    seed: int,
) -> tuple[list[list[float]], list[str]]:
    rng = random.Random(seed)
    xs: list[list[float]] = []
    ys: list[str] = []

    for level in (1, 2, 3, 4):
        collected = 0
        while collected < samples_per_level:
            if topic == "equation":
                q = equation.generate(level, rng=rng)
                analysis = analyze_equation_meta(q.meta)
                if analysis is None:
                    continue
                sample = gen_eq_sample(analysis, rng=rng, noisy_prob=noisy_prob, slip_prob=slip_prob)
                if sample is None:
                    continue
                val, label = sample
                feats, _ = extract_eq_features(analysis, level, val)
            elif topic == "simplify":
                q = simplify.generate(level, rng=rng)
                analysis = analyze_simplify_meta(q.meta)
                if analysis is None:
                    continue
                sample = generate_synthetic_simplify_sample(
                    analysis, rng=rng, noisy_prob=noisy_prob, slip_prob=slip_prob
                )
                if sample is None:
                    continue
                poly, label = sample
                feats, _ = extract_simplify_features_from_analysis(analysis, level, poly)
            else:
                q = arithmetic.generate(level, rng=rng)
                analysis = analyze_arithmetic_meta(q.meta)
                if analysis is None:
                    continue
                sample = generate_synthetic_arithmetic_sample(
                    analysis, rng=rng, noisy_prob=noisy_prob, slip_prob=slip_prob
                )
                if sample is None:
                    continue
                val, label = sample
                feats, _ = extract_arithmetic_features_from_analysis(analysis, level, val)

            xs.append(feats)
            ys.append(label)
            collected += 1
    return xs, ys


def _export_reg_tree(tree: Any, node_id: int = 0) -> Any:
    left = int(tree.children_left[node_id])
    if left == -1:
        return round(float(tree.value[node_id][0][0]), 6)
    right = int(tree.children_right[node_id])
    feat = int(tree.feature[node_id])
    thresh = round(float(tree.threshold[node_id]), 6)
    return [feat, thresh, _export_reg_tree(tree, left), _export_reg_tree(tree, right)]


def _export_cls_tree(tree: Any, node_id: int = 0) -> Any:
    left = int(tree.children_left[node_id])
    if left == -1:
        counts = tree.value[node_id][0]
        total = float(sum(counts))
        if total <= 0.0:
            n = len(counts)
            return [round(1.0 / n, 6)] * n
        return [round(float(c) / total, 6) for c in counts]
    right = int(tree.children_right[node_id])
    feat = int(tree.feature[node_id])
    thresh = round(float(tree.threshold[node_id]), 6)
    return [feat, thresh, _export_cls_tree(tree, left), _export_cls_tree(tree, right)]


def _print_bar_importances(feature_names: tuple[str, ...], importances: list[float], top_k: int = 12) -> None:
    pairs = sorted(zip(feature_names, importances), key=lambda kv: kv[1], reverse=True)[:top_k]
    max_imp = pairs[0][1] if pairs and pairs[0][1] > 0 else 1.0
    print(f"\nTop-{top_k} 特征重要性:")
    for name, imp in pairs:
        bar_len = int(round((imp / max_imp) * 26))
        print(f"  {name:<28} {imp:6.4f}  {'#' * bar_len}")


def train_one_topic(topic: str, args: argparse.Namespace, out_path: Path) -> None:
    import numpy as np
    from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
    from sklearn.model_selection import train_test_split

    all_codes_map = {
        "equation": EQUATION_ALL_CODES,
        "simplify": SIMPLIFY_ALL_CODES,
        "arithmetic": ARITHMETIC_ALL_CODES,
    }
    feat_names_map = {
        "equation": EQUATION_FEATURE_NAMES,
        "simplify": SIMPLIFY_FEATURE_NAMES,
        "arithmetic": ARITHMETIC_FEATURE_NAMES,
    }
    all_codes = all_codes_map[topic]
    feature_names = feat_names_map[topic]

    print("=" * 72)
    print(f"题型: {topic.upper()} | 模型: {args.model.upper()} | 目标: {out_path}")
    print("=" * 72)

    t0 = time.perf_counter()
    print(f"[1/4] 生成合成数据集 (L1~L4 各 {args.samples_per_level} 条, noisy={args.noisy_prob}, slip={args.slip_prob})...")
    X_list, y_list = _generate_dataset_for_topic(
        topic=topic,
        samples_per_level=args.samples_per_level,
        noisy_prob=args.noisy_prob,
        slip_prob=args.slip_prob,
        seed=args.seed,
    )

    real_count = 0
    if args.db is not None:
        r_x, r_y = _load_real_feedback_samples(topic, args.db, set(all_codes))
        real_count = len(r_y)
        if real_count > 0:
            for _ in range(max(1, args.real_weight)):
                X_list.extend(r_x)
                y_list.extend(r_y)
            print(f"      已混入 {real_count} 条真实确认反馈样本 (x{args.real_weight})")
        else:
            print(f"      未在 {args.db} 找到 {topic} 已确认的真实反馈样本，仅使用合成数据。")

    counts = Counter(y_list)
    print(f"      总样本数: {len(y_list)} (耗时 {time.perf_counter() - t0:.2f}s)")
    for code in all_codes:
        label = ALL_SPEC_BY_CODE[code].label
        print(f"        - {code:<22} ({label:<14}): {counts[code]}")

    X = np.asarray(X_list, dtype=np.float64)
    y = np.asarray(y_list)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=args.seed, stratify=y
    )

    print(f"\n[2/4] 开始训练 {args.model.upper()} (n_estimators={args.n_estimators}, max_depth={args.max_depth})...")
    t1 = time.perf_counter()
    if args.model == "gbdt":
        clf = GradientBoostingClassifier(
            n_estimators=args.n_estimators,
            max_depth=args.max_depth,
            learning_rate=args.learning_rate,
            subsample=0.85,
            random_state=args.seed,
        )
    else:
        clf = RandomForestClassifier(
            n_estimators=args.n_estimators,
            max_depth=args.max_depth,
            min_samples_leaf=3,
            n_jobs=-1,
            random_state=args.seed,
        )
    clf.fit(X_train, y_train)
    print(f"      训练完成 (耗时 {time.perf_counter() - t1:.2f}s)")

    print("\n[3/4] 测试集评估:")
    y_pred = clf.predict(X_test)
    acc = float(accuracy_score(y_test, y_pred))
    macro_f1 = float(f1_score(y_test, y_pred, average="macro"))
    weighted_f1 = float(f1_score(y_test, y_pred, average="weighted"))
    print(f"      Accuracy:    {acc:.4f}")
    print(f"      Macro F1:    {macro_f1:.4f}")
    print(f"      Weighted F1: {weighted_f1:.4f}")
    print("\n分类报告:")
    print(classification_report(y_test, y_pred, digits=4))

    classes = list(clf.classes_)
    cm = confusion_matrix(y_test, y_pred, labels=classes)
    print("混淆矩阵 (行=真实, 列=预测):")
    print(" " * 22 + " ".join(f"{c[:6]:>7}" for c in classes))
    for i, c in enumerate(classes):
        print(f"{c:<22}" + " ".join(f"{int(v):>7}" for v in cm[i]))

    _print_bar_importances(feature_names, list(clf.feature_importances_), top_k=12)

    print(f"\n[4/4] 导出纯 Python 推理模型至 {out_path} ...")
    payload: dict[str, Any] = {
        "topic": topic,
        "model_type": args.model,
        "version": f"{topic}-{args.model}-v1",
        "classes": classes,
        "feature_names": list(feature_names),
        "metrics": {
            "accuracy": round(acc, 4),
            "macro_f1": round(macro_f1, 4),
            "weighted_f1": round(weighted_f1, 4),
            "train_samples": int(len(y_train)),
            "test_samples": int(len(y_test)),
            "real_feedback_samples": real_count,
        },
    }

    if args.model == "gbdt":
        init_raw = clf._raw_predict_init(X_test[:1])[0]
        payload["learning_rate"] = float(clf.learning_rate)
        payload["init_raw"] = [round(float(v), 6) for v in init_raw]
        payload["trees"] = [
            [_export_reg_tree(clf.estimators_[m, k].tree_) for k in range(len(classes))]
            for m in range(clf.estimators_.shape[0])
        ]
    else:
        payload["trees"] = [_export_cls_tree(est.tree_) for est in clf.estimators_]

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = out_path.stat().st_size / 1024.0
    py_model = PureTreeModel.load(out_path)
    check_n = min(300, len(X_test))
    sk_probs = clf.predict_proba(X_test[:check_n])
    t_inf = time.perf_counter()
    max_diff = 0.0
    for i in range(check_n):
        py_p = py_model.predict_proba_list(X_test[i].tolist())
        for j in range(len(classes)):
            d = abs(py_p[j] - float(sk_probs[i, j]))
            if d > max_diff:
                max_diff = d
    avg_ms = (time.perf_counter() - t_inf) * 1000.0 / check_n

    print(f"      导出成功! 文件大小: {size_kb:.1f} KB")
    print(f"      纯 Python vs sklearn 最大概率误差: {max_diff:.6f}")
    print(f"      纯 Python 单条推理耗时: {avg_ms:.3f} ms\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="统一训练并导出 math-tutor 错因诊断模型")
    parser.add_argument(
        "--topic",
        choices=("equation", "simplify", "arithmetic", "all"),
        default="all",
        help="要训练的题型 (默认 all)",
    )
    parser.add_argument("--model", choices=("gbdt", "rf"), default="gbdt", help="模型类型 (默认 gbdt)")
    parser.add_argument("--samples-per-level", type=int, default=6000, help="每个难度样本数 (默认 6000)")
    parser.add_argument("--noisy-prob", type=float, default=0.10, help="复合/噪声错误比例 (默认 0.10)")
    parser.add_argument("--slip-prob", type=float, default=0.16, help="随机失误兜底类比例 (默认 0.16)")
    parser.add_argument("--n-estimators", type=int, default=60, help="树数量 / 迭代轮数 (默认 60)")
    parser.add_argument("--max-depth", type=int, default=3, help="最大树深 (默认 3)")
    parser.add_argument("--learning-rate", type=float, default=0.12, help="GBDT 学习率 (默认 0.12)")
    parser.add_argument("--seed", type=int, default=42, help="随机种子")
    parser.add_argument("--db", type=Path, default=None, help="可选 SQLite 路径，混入用户确认的真实反馈样本")
    parser.add_argument("--real-weight", type=int, default=5, help="真实反馈样本上采样倍率 (默认 5)")
    parser.add_argument("--out", type=Path, default=None, help="单题型时的自定义导出路径")
    args = parser.parse_args()

    try:
        import sklearn  # noqa: F401
    except ImportError as exc:
        print(
            "未安装 scikit-learn。请先安装离线训练可选依赖：\n"
            "  uv sync --extra dev --extra ml\n"
            f"错误详情: {exc}",
            file=sys.stderr,
        )
        raise SystemExit(1)

    topics = ("equation", "simplify", "arithmetic") if args.topic == "all" else (args.topic,)
    for topic in topics:
        out_path = args.out if (args.out is not None and len(topics) == 1) else DEFAULT_MODEL_PATHS[topic]
        train_one_topic(topic, args, out_path)


if __name__ == "__main__":
    main()
