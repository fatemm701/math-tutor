from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any


def _eval_reg_tree(node: Any, x: list[float]) -> float:
    """迭代求值回归树（GBDT 基学习器）。叶节点为 float，分支节点为 [feat, thresh, left, right]。"""
    cur = node
    while isinstance(cur, list):
        if x[cur[0]] <= cur[1]:
            cur = cur[2]
        else:
            cur = cur[3]
    return float(cur)


def _eval_rf_tree(node: Any, x: list[float]) -> list[float]:
    """迭代求值分类树（随机森林基学习器）。分支节点满足 node[2] 是 list，叶节点是概率列表。"""
    cur = node
    while isinstance(cur, list) and len(cur) == 4 and isinstance(cur[2], list):
        if x[cur[0]] <= cur[1]:
            cur = cur[2]
        else:
            cur = cur[3]
    return cur


def _softmax(scores: list[float]) -> list[float]:
    m = max(scores)
    exps = [math.exp(s - m) for s in scores]
    total = sum(exps)
    if total <= 0.0:
        n = len(scores)
        return [1.0 / n] * n
    return [e / total for e in exps]


class PureTreeModel:
    """
    零外部依赖的纯 Python 树集成推理器，支持：
    - model_type == "gbdt" (sklearn GradientBoostingClassifier 多分类)
    - model_type == "rf"   (sklearn RandomForestClassifier 多分类)
    """

    def __init__(self, payload: dict[str, Any]) -> None:
        self.model_type: str = payload["model_type"]
        self.version: str = str(payload.get("version", "1"))
        self.classes: list[str] = list(payload["classes"])
        self.feature_names: list[str] = list(payload["feature_names"])
        self.metrics: dict[str, Any] = dict(payload.get("metrics", {}))

        if self.model_type == "gbdt":
            self.learning_rate: float = float(payload["learning_rate"])
            self.init_raw: list[float] = [float(v) for v in payload["init_raw"]]
            # trees[m][k] 表示第 m 轮、第 k 类的回归树
            self.trees: list[Any] = payload["trees"]
        elif self.model_type == "rf":
            self.trees = payload["trees"]
        else:
            raise ValueError(f"不支持的模型类型: {self.model_type}")

    @classmethod
    def load(cls, path: Path) -> "PureTreeModel":
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
        return cls(payload)

    def predict_proba_list(self, features: list[float]) -> list[float]:
        if len(features) != len(self.feature_names):
            raise ValueError(
                f"特征维度不匹配: 期望 {len(self.feature_names)}，实际 {len(features)}"
            )

        k_count = len(self.classes)
        if self.model_type == "gbdt":
            scores = list(self.init_raw)
            lr = self.learning_rate
            for stage_trees in self.trees:
                for k in range(k_count):
                    scores[k] += lr * _eval_reg_tree(stage_trees[k], features)
            return _softmax(scores)

        # RandomForest: 各树叶概率均值
        acc = [0.0] * k_count
        n_trees = len(self.trees)
        for tree in self.trees:
            leaf = _eval_rf_tree(tree, features)
            for k in range(k_count):
                acc[k] += leaf[k]
        if n_trees > 0:
            inv = 1.0 / n_trees
            acc = [v * inv for v in acc]
        return acc

    def predict_proba(self, features: list[float]) -> dict[str, float]:
        probs = self.predict_proba_list(features)
        return {cls_name: probs[i] for i, cls_name in enumerate(self.classes)}
