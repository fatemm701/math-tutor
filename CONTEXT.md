# math-tutor 项目上下文契约 (CONTEXT.md)

## 1. 项目定位与硬性约束（不变量）
- **定位**：初中生「整式化简 / 一元一次方程 / 口算」练习工具，兼带教师看板与学生自查。
- **部署约束**：Docker 单容器（非 root uid 1000），256MB 内存上限（常驻 ≤ 65MB）。
- **技术栈**：Python 3.12+ + FastAPI + Uvicorn (单 Worker) + SQLite (`sqlite3`) + Jinja2 + 极简原生 JS (`fetch`) + 本地 KaTeX（无 CDN，无外部数据库）。
- **禁止引入 SymPy**：所有数学逻辑用标准库 `fractions.Fraction` + 自研轻量表达式树实现，保证零浮点误差且能做「未去括号 / 未合并同类项 / 未约分」等教学级判卷。
- **计分口径（全局统一）**：
  - 看了提示仍做对 → 算对（`used_hint=1, result='correct'`）。
  - 主动点「看解析」→ 算错（`gave_up=1, revealed=1`）。
  - 答错 2 次自动弹出解析 → 不算「看解析」（`gave_up=0, revealed=1`）。
  - 格式错（`result='error'`）不计入答错次数，不锁键盘，统计聚合中自动排除。
- **显示与排版规则**：
  - 分数统一用 KaTeX `\dfrac` 上下分式渲染；口算题标准答案格式必须跟随题面（题面含小数则答案显示小数，含分数则显示分数）。
  - 手机端解析区采用竖排（标题行 / 公式行 / 中文讲解行），禁止横向滚动。
  - 权限严格隔离：学生自查接口只认 Session 中的 `user_id`，绝不接收外部 `userId` 参数；教师接口严格校验 `role == 'teacher'` 与 `teacher_id` 归属。
- **框架注意事项**：
  - 新版 Starlette 的 `TemplateResponse` 必须按 `TemplateResponse(request, "name.html", context)` 传参。
  - 本地运行测试与服务统一用 `uv run pytest` 和 `uv run uvicorn app.main:app --reload`。

## 2. 目录结构（带 ✓ 表示已实现）
```text
math-tutor/
├── CONTEXT.md                  # ✓ 本文件（全局契约与进度）
├── pyproject.toml              # ✓ 依赖与 pytest 配置
├── Dockerfile                  # ✓ 非 root (uid 1000)、单 Worker 镜像构建
├── docker-compose.yml          # ✓ 256MB 内存上限与数据卷持久化配置
├── app/
│   ├── main.py                 # ✓ FastAPI 入口、静态挂载、/api/health、路由注册
│   ├── config.py               # ✓ 环境变量（TEACHER_INVITE, DB_PATH, APP_VERSION 等）
│   ├── db.py                   # ✓ SQLite 连接管理、WAL 模式、建表与索引
│   ├── auth.py                 # ✓ scrypt 哈希、Session Cookie、IP 登录限速
│   ├── scoring.py              # ✓ 统计口径与 SQL 多维聚合（看板/自查共用）
│   ├── engines/                # 纯 Python 数学引擎（零 Web 依赖）
│   │   ├── types.py            # ✓ 统一数据契约（Question, GradeResult, Step 等）
│   │   ├── rational.py         # ✓ Fraction 扩展与 LaTeX/小数格式化工具
│   │   ├── expr_tree.py        # ✓ 递归下降解析器 + 表达式树（simplify/equation 共用）
│   │   ├── simplify.py         # ✓ 整式化简引擎（4 档）
│   │   ├── equation.py         # ✓ 一元一次方程引擎（4 档，5 步等价变形）
│   │   └── arithmetic.py       # ✓ 口算引擎（4 档，含简算与小数/分数显示匹配）
│   ├── routers/
│   │   ├── pages.py            # ✓ 页面路由（/, /simplify, /equation, /arithmetic, /dashboard）
│   │   ├── drill.py            # ✓ 通用出题/判题/看解析路由（ENGINES 注册表 + LRU 缓存）
│   │   ├── auth.py             # ✓ /api/auth/*
│   │   └── dashboard.py        # ✓ /api/attempts/me/*, /api/teacher/*
│   ├── templates/
│   │   ├── base.html           # ✓ 公共骨架：左侧可收起导航栏、窄屏抽屉、夜间模式
│   │   ├── login.html          # ✓ 登录 / 注册页
│   │   ├── placeholder.html    # ✓ 临时占位模板（保留备用）
│   │   ├── drill_base.html     # ✓ 练习页通用骨架（难度条、题面、软键盘插槽、解析区）
│   │   ├── simplify.html       # ✓ 整式化简页（继承 drill_base）
│   │   ├── equation.html       # ✓ 一元一次方程页（继承 drill_base）
│   │   ├── arithmetic.html     # ✓ 口算训练页（继承 drill_base）
│   │   └── dashboard.html      # ✓ 教师看板 / 学生自查（按角色切换视图）
│   └── static/
│       ├── css/app.css         # ✓ 公共样式、夜间模式、练习页、软键盘与看板样式
│       ├── js/nav.js           # ✓ 侧边栏状态、窄屏抽屉、夜间模式、登出
│       ├── js/drill.js         # ✓ 练习页通用交互（出题、软键盘、提交、看解析、KaTeX）
│       └── vendor/katex/       # ✓ 本地 KaTeX 资源
└── tests/
    ├── test_auth.py            # ✓ 认证与 IP 限速测试
    ├── test_expr_tree.py       # ✓ 有理数与表达式树底座测试
    ├── test_simplify.py        # ✓ 整式化简 1000 题模糊校验 + 判题全分支测试
    ├── test_equation.py        # ✓ 一元一次方程 1000 题模糊校验 + 判题全分支测试
    ├── test_arithmetic.py      # ✓ 口算 1000 题模糊校验 + 格式匹配与判题测试
    ├── test_api.py             # ✓ 练习链路与教师/学生权限隔离集成测试
    └── test_pages.py           # ✓ 页面渲染回归（登录切换、软键盘布局、触屏不聚焦）
```

## 3. SQLite 表结构 (`app/db.py`)

```sql
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,           -- scrypt:salt:hash
    role          TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
    invite_code   TEXT UNIQUE,             -- 仅老师有，6 位字母数字
    teacher_id    INTEGER REFERENCES users(id),
    created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
    sid           TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at    INTEGER NOT NULL
);

CREATE TABLE attempts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id      TEXT NOT NULL UNIQUE,   -- 前端生成的幂等 ID，INSERT OR IGNORE
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic          TEXT NOT NULL CHECK (topic IN ('simplify', 'equation', 'arithmetic')),
    level          INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4),
    question       TEXT NOT NULL,
    answer         TEXT NOT NULL,
    student_answer TEXT NOT NULL,
    result         TEXT NOT NULL CHECK (result IN (
                       'correct', 'wrong', 'parentheses', 'unmerged',
                       'unisolated', 'unreduced', 'error'
                   )),
    used_hint      INTEGER NOT NULL DEFAULT 0,
    revealed       INTEGER NOT NULL DEFAULT 0,
    gave_up        INTEGER NOT NULL DEFAULT 0,
    is_fraction    INTEGER NOT NULL DEFAULT 0,
    is_decimal     INTEGER NOT NULL DEFAULT 0,
    ms             INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
);
```

## 4. 数学引擎统一接口契约 (`app/engines/types.py`)

- `Topic = Literal["simplify", "equation", "arithmetic"]`
- `ResultCode = Literal["correct", "wrong", "parentheses", "unmerged", "unisolated", "unreduced", "error"]`
- `Step(title, tex, note="", note_tex="")`
- `Question(topic, level, prompt_raw, prompt_tex, answer_raw, answer_tex, hint, steps, is_fraction=False, is_decimal=False, meta={})`
- `GradeResult(result, is_correct, feedback, student_tex="")`
- 每个引擎必须暴露：
  - `generate(level: int, rng: random.Random | None = None) -> Question`
  - `grade(question: Question, student_input: str) -> GradeResult`

## 5. Web 层与 API 契约

- **统一 JSON 响应**：`{"success": true, "data": ...}` 或 `{"success": false, "msg": "..."}`。
- **认证**：Cookie 名 `pd_sid`（`HttpOnly`, `SameSite=Lax`）。注册接口字段采用驼峰命名（`teacherInvite` / `inviteCode`）。
- **练习接口（`app/routers/drill.py`）**：
  - `GET /api/drill/{topic}/next?level=N`：生成 `Question` 存入内存 LRU 缓存（上限 2000 条），返回 `token` 与题面。
  - `POST /api/drill/{topic}/submit`：判题，答对或错满 2 次自动落库并返回 `steps`。
  - `POST /api/drill/{topic}/giveup`：标记 `gave_up=1` 落库并返回 `steps`。
  - `ENGINES` 已注册全部三个题型：`simplify`、`equation`、`arithmetic`。
- **看板与自查接口（`app/routers/dashboard.py`）**：
  - `GET /api/attempts/me/summary?days=30&topic=...`：当前登录用户的 KPI、题型/难度分布与错因分布。
  - `GET /api/attempts/me/recent?limit=30&only_wrong=false&topic=...`：当前登录用户最近做题记录。
  - `GET /api/teacher/students?days=30`：教师班级邀请码与名下学生汇总列表（仅教师可访问）。
  - `GET /api/teacher/students/{student_id}?days=30&only_wrong=false`：名下单个学生详情与记录（校验 `teacher_id` 归属）。

## 6. 当前进度

- [x] 阶段 0：确定架构与 `CONTEXT.md` 契约
- [x] 阶段 1：项目骨架、`db.py`、`auth.py`、`base.html`（侧边栏 + 夜间模式）+ 登录页
- [x] 阶段 2：`rational.py` + `expr_tree.py` + `simplify.py` + 通用练习底座与化简练习页
- [x] 阶段 3：`equation.py` + 方程练习页与单测
- [x] 阶段 4：`arithmetic.py` + 口算练习页与单测
- [x] 阶段 5：`scoring.py` + `dashboard.html`（教师/学生隔离）+ `test_api.py` + Docker 部署