# math-tutor · 初中数学练习工具

面向初中生的**整式化简 / 一元一次方程 / 口算**练习工具，带**错因诊断式判题**、**分步解析**与**教师看板**。

[![Python](https://img.shields.io/badge/Python-3.12%2B-3776ab?logo=python&logoColor=white)](#技术架构)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?logo=fastapi&logoColor=white)](#技术架构)
[![SQLite](https://img.shields.io/badge/SQLite-3-003b57?logo=sqlite&logoColor=white)](#数据库)
[![Tests](https://img.shields.io/badge/tests-38%20passed-brightgreen)](#测试)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**在线体验**：<https://math-tutor.gyf-time.cn> —— 学生可直接注册；老师注册需要服务端配置的管理员口令。

---

## 它解决什么问题

市面上的口算 / 化简工具大多只能判断「对」或「错」。但学生做错整式化简时，真正的问题往往很具体：**括号没去、同类项没合并、移项没变号、分数没约分**。只告诉他"错了"没有帮助——他不知道自己错在哪一步。

math-tutor 的判题是**教学级**的：

- **能分辨错因**。判题结果不止 `correct` / `wrong`，还有 `parentheses`（未去括号）、`unmerged`（未合并同类项）、`unisolated`（未移项）、`unreduced`（未约分）。看板会按错因聚合，老师和学生一眼能看出"这个孩子总是栽在去括号上"。
- **零浮点误差**。全部数学逻辑用标准库 `fractions.Fraction` + 自研轻量表达式树实现，**刻意不引入 SymPy**——既保持零依赖，也避免浮点数比较带来的误判。
- **分步解析**。每道题都带讲解步骤（化简 4 档难度、方程 5 步等价变形），答错 2 次自动弹出，不是简单丢一个答案。
- **手机可用**。软键盘按题型定制，点屏幕按键**不会弹出系统键盘**；同一套键盘布局在三种题型里位置完全一致。

---

## 功能一览

| 题型 | 四档难度 | 说明 |
|---|---|---|
| **整式化简** | ① 入门 ② 基础 ③ 进阶 ④ 挑战 | 含分数系数、多重括号、幂次；判题识别未去括号 / 未合并同类项 / 未约分 |
| **一元一次方程** | ① 入门 ② 基础 ③ 进阶 ④ 挑战 | 5 步等价变形讲解；判题识别未移项；键盘含括号键 |
| **口算训练** | ① 入门 ② 基础 ③ 进阶 ④ 挑战 | 含简算与小数 / 分数题；答案格式跟随题面（题面是小数就答小数） |

**教师看板**：班级邀请码、名下学生汇总、单个学生的 KPI / 题型分布 / 难度分布 / 错因分布 / 最近记录。
**学生自查**：自己的同样的那套统计数据，只认 Session 身份。

---

## 快速开始

```bash
git clone git@github.com:fatemm701/math-tutor.git
cd math-tutor

# 安装依赖（含开发依赖 pytest / httpx）
uv sync --extra dev

# 启动
uv run uvicorn app.main:app --reload
```

打开 <http://127.0.0.1:8000>。首次启动会自动建表，数据库落在 `data/poly_drill.db`（已在 `.gitignore` 中，不会误提交）。

> **注意**：`pytest` 与 `httpx` 定义在 `[project.optional-dependencies]` 的 `dev` 组里，所以必须加 `--extra dev`。
> 只写 `uv sync` 会**卸载**这两个包，之后跑测试会报 `ModuleNotFoundError: No module named 'pytest'`。
> 生产环境不需要开发依赖，用 `uv sync` 或 Docker 即可。

---

## 配置项

全部通过环境变量配置，均有默认值：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DB_PATH` | `data/poly_drill.db` | SQLite 数据库路径，首次启动自动建表 |
| `TEACHER_INVITE` | 空 | **教师注册所需的管理员口令**。不设置则教师注册入口直接返回 403，即"关闭注册" |
| `APP_VERSION` | `dev` | 拼在静态资源 URL 后的版本号（`?v=...`），用于刷新浏览器缓存 |
| `SESSION_TTL_DAYS` | `30` | 登录状态有效天数 |
| `COOKIE_SECURE` | `0` | 设为 `1` 时 Cookie 带 `Secure` 标记，**仅 HTTPS 部署时开启** |

---

## 使用说明

### 学生

1. 在首页**注册**（用户名 2~20 字，密码至少 4 位）。
2. 如果老师给了 6 位**邀请码**，注册时填入，完成后就会出现在该老师的看板里；不填也能用，只是没有老师看数据。
3. 选题型 → 选难度 → 作答。手机上点下方软键盘输入；如需用系统输入法（比如输入复杂表达式），**长按输入框约 0.5 秒**即可调出。
4. 答错两次会自动展示解析；也可以主动点「看解析」。

### 老师

1. 注册时选「老师」，填入服务端配置的 `TEACHER_INVITE` 口令。**口令正确才注册成功**，注册后会拿到一个 6 位邀请码。
2. 把邀请码发给学生，学生注册时填入即完成绑定。
3. 打开**看板**查看班级汇总；点学生可看其个人详情与逐题记录。

### 计分口径

这是最容易产生困惑的地方，规则是全局统一的：

| 情形 | 判定 |
|---|---|
| 看了提示后仍做对 | **算对**（`used_hint=1`） |
| 主动点「看解析」 | **算错**（`gave_up=1, revealed=1`） |
| 答错 2 次后自动弹出解析 | 不算"看解析"（`gave_up=0, revealed=1`） |
| 格式错误 | 记录为 `error`，**不计入答错次数、不锁键盘**，统计聚合时自动排除 |

---

## 技术架构

```text
math-tutor/
├── app/
│   ├── main.py              FastAPI 入口、静态挂载、/api/health、路由注册
│   ├── config.py            环境变量
│   ├── db.py                SQLite 连接管理、WAL、建表与索引
│   ├── auth.py              scrypt 哈希、Session Cookie、IP 登录限速
│   ├── scoring.py           统计口径与 SQL 多维聚合（看板 / 自查共用）
│   ├── engines/             纯 Python 数学引擎（零 Web 依赖）
│   │   ├── types.py         统一数据契约（Question / GradeResult / Step）
│   │   ├── rational.py      Fraction 扩展、LaTeX 与小数格式化
│   │   ├── expr_tree.py     递归下降解析器 + 表达式树（化简 / 方程共用）
│   │   ├── simplify.py      整式化简引擎（4 档）
│   │   ├── equation.py      一元一次方程引擎（4 档，5 步等价变形）
│   │   └── arithmetic.py    口算引擎（4 档）
│   ├── routers/             页面路由与 API（pages / drill / auth / dashboard）
│   ├── templates/           Jinja2 模板
│   └── static/              app.css、drill.js、nav.js、本地 KaTeX
└── tests/                   7 个测试文件，38 个用例
```

**分层的关键在于 `engines/` 完全不知道 Web 的存在。** 它不 import FastAPI、不碰数据库、不碰模板，只做"生成题目"和"判题"两件事。这带来两个好处：

1. 可以做**千题级模糊测试**——直接批量生成再判题，不需要任何网络请求；
2. 想换前端（小程序、命令行）时，换掉 `routers/` 和 `templates/` 即可，数学内核不动。

每个引擎统一暴露两个函数：

```python
def generate(level: int, rng: random.Random | None = None) -> Question
def grade(question: Question, student_input: str) -> GradeResult
```

---

## 数据库

三张表，定义见 [`app/db.py`](app/db.py)（此处不复制 DDL，避免文档与代码漂移）：

- **`users`** —— 账号。`role` 只有 `teacher` / `student`；老师额外持有唯一的 6 位 `invite_code`；学生用 `teacher_id` 关联老师。
- **`sessions`** —— 登录会话，`sid` 存 Cookie `pd_sid`，带过期时间。
- **`attempts`** —— 每次作答。`client_id` 是前端生成的幂等 ID（`INSERT OR IGNORE`，防止重复提交）；`result` 记录七种结果码之一；`used_hint` / `revealed` / `gave_up` 对应上面的计分口径。

两个索引分别服务「按时间倒序取最近记录」和「按题型 / 难度 / 结果过滤聚合」。数据库开启 WAL 模式与 `foreign_keys=ON`。

---

## API 速览

统一响应格式：成功 `{"success": true, "data": ...}`，失败 `{"success": false, "msg": "..."}`。认证用 Cookie `pd_sid`（`HttpOnly`、`SameSite=Lax`）。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 健康检查（无需登录） |
| `POST` | `/api/auth/register` | 注册（字段驼峰：`teacherInvite` / `inviteCode`） |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/logout` | 登出 |
| `GET` | `/api/auth/me` | 当前登录用户 |
| `GET` | `/api/drill/{topic}/next?level=N` | 出题，题目进内存 LRU 缓存，返回 `token` 与题面 |
| `POST` | `/api/drill/{topic}/submit` | 判题；答对或错满 2 次自动落库并返回解析 |
| `POST` | `/api/drill/{topic}/giveup` | 主动看解析（记为 `gave_up`） |
| `GET` | `/api/attempts/me/summary?days=30` | 本人 KPI、题型 / 难度 / 错因分布 |
| `GET` | `/api/attempts/me/recent?limit=30&only_wrong=false` | 本人最近记录 |
| `GET` | `/api/teacher/students?days=30` | 名下学生汇总（仅教师） |
| `GET` | `/api/teacher/students/{id}?days=30` | 单个学生详情（校验 `teacher_id` 归属） |

`{topic}` 取 `simplify` / `equation` / `arithmetic`。

**权限隔离**是硬约束：学生自查接口只认 Session 里的 `user_id`，**绝不接收外部传入的 `userId`**；教师接口严格校验 `role == 'teacher'` 与 `teacher_id` 归属。

---

## 测试

```bash
uv run --extra dev pytest -q
```

当前 **38 passed**。测试构成：

- `test_expr_tree.py` —— 有理数与表达式树底座
- `test_simplify.py` / `test_equation.py` / `test_arithmetic.py` —— 每个引擎 **1000 题模糊校验** + 判题全分支覆盖
- `test_auth.py` —— 认证与 IP 登录限速
- `test_api.py` —— 完整练习链路 + 教师 / 学生权限隔离
- `test_pages.py` —— 页面渲染回归（登录页切换结构、软键盘布局与键位一致性、触屏不误聚焦）

---

## 部署

```bash
docker compose up -d --build
```

- 容器以**非 root**（uid 1000）运行，内存上限 **256MB**（常驻约 65MB）。
- 数据库通过 `./data` 卷持久化到宿主机。
- 单 Worker 运行——这是刻意设计，见下方「已知限制」。

生产环境**至少**要设置这两个变量：

```yaml
environment:
  - TEACHER_INVITE=换成你自己的口令
  - APP_VERSION=1.1.0          # 每次发版改一下，否则用户可能一直用缓存的旧前端
```

> **`TEACHER_INVITE` 不设置 = 任何人都能注册成老师。** 正式上线前务必配置。

---

## 已知限制与设计取舍

这些是**有意的选择**，不是遗漏：

- **单 Worker + 内存 LRU 出题缓存**（上限 2000 条）。题目缓存在进程内存里，多进程会导致提交时找不到题目；因此不支持水平扩展，换来的是零外部依赖。
- **SQLite 单文件**。适合一个班到一所学校的规模，不适合高并发写入。
- **无密码找回、无邮箱验证**。面向课堂场景，账号由老师统一分发。
- **教师权限是单个共享口令 + 邀请码二分**，不是细粒度角色系统。
- **不使用 SymPy**。自研表达式树能精确判断"未去括号 / 未合并同类项"这类教学状态，SymPy 的化简视角反而不适合这个场景。

---

## 相关文档

- [CONTEXT.md](CONTEXT.md) —— 全局契约：设计不变量、目录结构、表结构、API 契约与开发进度。改代码前建议先读。

---

## License

[MIT](LICENSE) © 2026 高于凡