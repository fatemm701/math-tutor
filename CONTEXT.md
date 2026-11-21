
# poly-drill-py 项目上下文契约 (CONTEXT.md)

## 1. 项目定位与硬性约束（不变量）

- **定位**：初中生「整式化简 / 一元一次方程 / 口算」练习工具，兼带教师看板与学生自查。
- **部署约束**：Docker 单容器（非 root uid 1000），256MB 内存上限（常驻 ≤ 65MB）。
- **技术栈**：Python 3.12 + FastAPI + Uvicorn (单 Worker) + SQLite (`sqlite3`) + Jinja2 + HTMX + 本地 KaTeX（无 CDN，无外部数据库）。
- **禁止引入 SymPy**：所有数学逻辑用标准库 `fractions.Fraction` + 自研轻量表达式树实现，保证零浮点误差且能做「未去括号 / 未合并同类项 / 未约分」等教学级判卷。
- **计分口径（全局统一）**：
  - 看了提示仍做对 → 算对（`used_hint=1, result='correct'`）。
  - 主动点「看解析」→ 算错（`gave_up=1, revealed=1`）。
  - 答错 2 次自动弹出解析 → 不算「看解析」（`gave_up=0, revealed=1`）。
- **显示与排版规则**：
  - 分数统一用 KaTeX `\dfrac` 上下分式渲染；口算题标准答案格式必须跟随题面（题面含小数则答案显示小数，含分数则显示分数）。
  - 手机端解析区采用竖排（标题行 / 公式行 / 中文讲解行），禁止横向滚动。
  - 权限严格隔离：学生自查接口只认 Session 中的 `user_id`，绝不接收外部 `userId` 参数。

## 2. 目录结构

```text
poly-drill-py/
├── CONTEXT.md                  # 本文件（全局契约与进度）
├── pyproject.toml              # 依赖与 pytest 配置
├── Dockerfile / docker-compose.yml
├── app/
│   ├── main.py                 # FastAPI 入口、静态挂载、/api/health
│   ├── config.py               # 环境变量（TEACHER_INVITE, DB_PATH, SECRET_KEY）
│   ├── db.py                   # SQLite 连接管理、建表与索引
│   ├── auth.py                 # scrypt 哈希、Session Cookie、IP 登录限速
│   ├── scoring.py              # 统计口径与 SQL 多维聚合（看板/自查共用）
│   ├── engines/                # 纯 Python 数学引擎（零 Web 依赖）
│   │   ├── types.py            # 统一数据契约（Question, GradeResult, Step 等）
│   │   ├── rational.py         # Fraction 扩展与 LaTeX 格式化工具
│   │   ├── expr_tree.py        # 递归下降解析器 + 表达式树（simplify/equation 共用）
│   │   ├── simplify.py         # 整式化简引擎（4 档）
│   │   ├── equation.py         # 一元一次方程引擎（4 档，5 步等价变形）
│   │   └── arithmetic.py       # 口算引擎（4 档，含简算与小数/分数显示匹配）
│   ├── routers/
│   │   ├── pages.py            # 页面路由（/, /simplify, /equation, /arithmetic, /dashboard）
│   │   ├── drill.py            # 出题 / 判题 / 提示（HTMX 片段 + JSON）
│   │   ├── auth.py             # /api/auth/*
│   │   └── dashboard.py        # /api/attempts/*, /api/teacher/*
│   ├── templates/              # base.html, login.html, drill_base.html, dashboard.html 等
│   └── static/                 # css/, js/keyboard.js, js/nav.js, vendor/katex/
└── tests/                      # test_simplify.py, test_equation.py, test_arithmetic.py, test_api.py
```
