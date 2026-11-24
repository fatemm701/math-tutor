"""
离线训练一元一次方程错因诊断模型（GBDT / RandomForest），并导出为纯 Python 可推理的轻量 JSON。

用法示例：
  uv run --extra ml python scripts/train_equation_diagnosis.py
  uv run --extra ml python scripts/train_equation_diagnosis.py --model rf --n-estimators 50 --max-depth 8
  uv run --extra ml python scripts/train_equation_diagnosis.py --db data/poly_drill.db --real-weight 5
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

# 允许直接 `python scripts/train_equation_diagnosis.py` 运行
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.diagnosis.equation_features import (  # noqa: E402
    FEATURE_NAMES,
    extract_features_from_analysis,
    extract_features_from_meta,
)
from app.diagnosis.equation_sim import (  # noqa: E402
    analyze_equation_meta,
    generate_synthetic_wrong_sample,
)
from app.diagnosis.predictor import DEFAULT_EQUATION_MODEL_PATH  # noqa: E402
from app.diagnosis.taxonomy import EQUATION_ALL_CODES, EQUATION_SPEC_BY_CODE  # noqa: E402
from app.diagnosis.tree_infer import PureTreeModel  # noqa: E402
from app.engines import equation  # noqa: E402
from app.engines.expr_tree import ZERO_KEY, expand, parse_expr, poly_sub  # noqa: E402
from app.engines.rational import parse_number_strict  # noqa: E402


def _parse_student_x(raw: str) -> Fraction | None:
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


def _load_real_feedback_samples(db_path: Path) -> tuple[list[list[float]], list[str]]:
    """从 SQLite diagnosis_logs 中读取已被用户点击「猜中了(feedback=1)」的真实样本用于增量训练。"""
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
            WHERE topic = 'equation' AND feedback = 1
            """
        ).fetchall()
    finally:
        conn.close()

    xs: list[list[float]] = []
    ys: list[str] = []
    valid_codes = set(EQUATION_ALL_CODES)
    for r in rows:
        code = r["predicted_code"]
        if code not in valid_codes:
            continue
        student_x = _parse_student_x(r["student_answer"])
        if student_x is None:
            continue
        try:
            meta = json.loads(r["meta_json"])
        except Exception:
            continue
        extracted = extract_features_from_meta(meta, int(r["level"]), student_x)
        if extracted is None:
            continue
        feats, _, _ = extracted
        xs.append(feats)
        ys.append(code)
    return xs, ys


def _generate_synthetic_dataset(
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
            q = equation.generate(level, rng=rng)
            analysis = analyze_equation_meta(q.meta)
            if analysis is None:
                continue
            sample = generate_synthetic_wrong_sample(
                analysis, rng=rng, noisy_prob=noisy_prob, slip_prob=slip_prob
            )
            if sample is None:
                continue
            student_x, label = sample
            feats, _ = extract_features_from_analysis(analysis, level, student_x)
            xs.append(feats)
            ys.append(label)
            collected += 1
    return xs, ys


def _export_reg_tree(tree: Any, node_id: int = 0) -> Any:
    """将 sklearn DecisionTreeRegressor 导出为紧凑嵌套结构。"""
    left = int(tree.children_left[node_id])
    if left == -1:
        return round(float(tree.value[node_id][0][0]), 6)
    right = int(tree.children_right[node_id])
    feat = int(tree.feature[node_id])
    thresh = round(float(tree.threshold[node_id]), 6)
    return [feat, thresh, _export_reg_tree(tree, left), _export_reg_tree(tree, right)]


def _export_cls_tree(tree: Any, node_id: int = 0) -> Any:
    """将 sklearn DecisionTreeClassifier 导出为紧凑嵌套结构（叶节点为归一化概率列表）。"""
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


def _print_bar_importances(importances: list[float], top_k: int = 15) -> None:
    pairs = sorted(zip(FEATURE_NAMES, importances), key=lambda kv: kv[1], reverse=True)[:top_k]
    max_imp = pairs[0][1] if pairs and pairs[0][1] > 0 else 1.0
    print(f"\nTop-{top_k} 特征重要性:")
    for name, imp in pairs:
        bar_len = int(round((imp / max_imp) * 28))
        bar = "#" * bar_len
        print(f"  {name:<26} {imp:6.4f}  {bar}")


def main() -> None:
    parser = argparse.ArgumentParser(description="训练并导出方程错因诊断树模型")
    parser.add_argument("--model", choices=("gbdt", "rf"), default="gbdt", help="模型类型 (默认 gbdt)")
    parser.add_argument("--samples-per-level", type=int, default=6000, help="每个难度生成的样本数 (默认 6000)")
    parser.add_argument("--noisy-prob", type=float, default=0.12, help="复合/噪声错误比例 (默认 0.12)")
    parser.add_argument("--slip-prob", type=float, default=0.16, help="随机算术失误(兜底类)比例 (默认 0.16)")
    parser.add_argument("--n-estimators", type=int, default=60, help="树的数量 / 迭代轮数 (默认 60)")
    parser.add_argument("--max-depth", type=int, default=3, help="单棵树最大深度 (默认 3；RF 可设 8~12)")
    parser.add_argument("--learning-rate", type=float, default=0.12, help="GBDT 学习率 (默认 0.12)")
    parser.add_argument("--seed", type=int, default=42, help="随机种子")
    parser.add_argument("--db", type=Path, default=None, help="可选 SQLite 路径，混入用户确认的真实反馈样本")
    parser.add_argument("--real-weight", type=int, default=5, help="真实反馈样本的上采样倍率 (默认 5)")
    parser.add_argument("--out", type=Path, default=DEFAULT_EQUATION_MODEL_PATH, help="导出 JSON 路径")
    args = parser.parse_args()

    try:
        import numpy as np
        from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
        from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
        from sklearn.model_selection import train_test_split
    except ImportError as exc:
        print(
            "未安装 scikit-learn。请先安装离线训练可选依赖：\n"
            "  uv sync --extra dev --extra ml\n"
            f"错误详情: {exc}",
            file=sys.stderr,
        )
        raise SystemExit(1)

    t0 = time.perf_counter()
    print(f"[1/4] 正在生成合成数据集 (L1~L4 各 {args.samples_per_level} 条, noisy={args.noisy_prob}, slip={args.slip_prob})...")
    X_list, y_list = _generate_synthetic_dataset(
        samples_per_level=args.samples_per_level,
        noisy_prob=args.noisy_prob,
        slip_prob=args.slip_prob,
        seed=args.seed,
    )

    real_count = 0
    if args.db is not None:
        r_x, r_y = _load_real_feedback_samples(args.db)
        real_count = len(r_y)
        if real_count > 0:
            for _ in range(max(1, args.real_weight)):
                X_list.extend(r_x)
                y_list.extend(r_y)
            print(f"      已混入 {real_count} 条真实确认反馈样本 (x{args.real_weight})")
        else:
            print(f"      未在 {args.db} 找到已确认的真实反馈样本，仅使用合成数据。")

    counts = Counter(y_list)
    print(f"      总样本数: {len(y_list)} (耗时 {time.perf_counter() - t0:.2f}s)")
    print("      类别分布:")
    for code in EQUATION_ALL_CODES:
        label = EQUATION_SPEC_BY_CODE[code].label
        print(f"        - {code:<18} ({label:<12}): {counts[code]}")

    X = np.asarray(X_list, dtype=np.float64)
    y = np.asarray(y_list)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=args.seed, stratify=y
    )

    print(f"\n[2/4] 开始训练 {args.model.upper()} 模型 (n_estimators={args.n_estimators}, max_depth={args.max_depth})...")
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
    train_sec = time.perf_counter() - t1
    print(f"      训练完成 (耗时 {train_sec:.2f}s)")

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
    header = " " * 18 + " ".join(f"{c[:6]:>7}" for c in classes)
    print(header)
    for i, c in enumerate(classes):
        row_str = " ".join(f"{int(v):>7}" for v in cm[i])
        print(f"{c:<18}{row_str}")

    _print_bar_importances(list(clf.feature_importances_), top_k=15)

    print(f"\n[4/4] 导出纯 Python 推理模型至 {args.out} ...")
    payload: dict[str, Any] = {
        "model_type": args.model,
        "version": f"eq-{args.model}-v1",
        "classes": classes,
        "feature_names": list(FEATURE_NAMES),
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

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = args.out.stat().st_size / 1024.0

    # 一致性与纯 Python 推理耗时校验
    py_model = PureTreeModel.load(args.out)
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
    print(f"      纯 Python 单条推理耗时: {avg_ms:.3f} ms")


if __name__ == "__main__":
    main()
