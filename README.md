# 整式化简练习（poly-drill）

给初中生练「整式化简」的网页工具：**出题、判题、分步解析全在浏览器里跑**，服务端只负责登录、存档和统计。
一台 256MB 内存的小机器就能跑（Docker 单容器，常驻约 60MB）。

## 功能

**练习页** `frontend/practice.html`（结构）+ `frontend/js/practice.js`（交互）

- 4 个难度：① 入门 / ② 基础 / ③ 进阶 / ④ 挑战，题目按「去括号 → 合并同类项」的结构生成
- ①②③ 只用一个字母 `x`；④ 挑战用 `x`、`y` 两个字母，考「xy、x²、y² 各算一类」
- ②-④ 按比例混入分数系数题（L2 25%、L3 40%、L4 50%），题目标「分数」标签；① 保持整数题
- 物理键盘 + 屏幕软键盘，支持 `x` `y` `^2` `^3` 和分数线 `/`（如 `1/2x + 3/4`）；屏幕上的字母键用数学斜体，和乘号 `×` 区分开
- 分数题用 KaTeX 上下分式（`\dfrac`）显示，整数题保持原写法
- 答对立刻给完整推导；答错 2 次、或点「看解析」也给推导，并附一行「你的答案」对照
- 答错、用提示、直接看解析分开计数（后两类不计入正确率）

**教师看板** `frontend/teacher.html`

- 汇总卡片 + 学生表格：题数、正确率、错题数、用提示数、看解析数、平均用时、最后活跃、四档分布、分数题正确/总数
- 点学生看最近 100 条明细
- 添加学生账号；「我自己」面板单独统计老师本人的练习，不混入学生数据

**账号**

- 口令用 scrypt 加盐哈希，会话走随机 session id + HttpOnly Cookie
- 老师凭环境变量里的管理员口令注册，注册成功拿到 6 位邀请码；学生填邀请码后自动挂到该老师名下
- 登录失败按 IP 限速

## 技术栈

| 层 | 实现 |
|---|---|
| 前端 | 页面 + 模块化原生 JS；基础多项式在 `frontend/js/math-core.js`，出题/判题/解析在 `frontend/js/engine-simplify.js`，渲染与交互在 `frontend/js/practice.js`；KaTeX、mathjs 放在 `frontend/vendor/`，**不依赖 CDN** |
| 后端 | Node.js 22 + Express 5，只做静态托管 + 认证 + 记录读写，**不做数学计算** |
| 存储 | 单个 JSON 文件 `data/db.json`（先写临时文件再 rename，原子替换；无文件锁，只支持单实例） |
| 部署 | Docker / Docker Compose，非 root（uid 1000）运行，内置 healthcheck |

## 目录

```
backend/
  server.js            Express 入口、静态托管、/api/health
  auth.js              scrypt 哈希、会话、登录限速
  store.js             db.json 读写（原子写）
  routes/              auth / attempts / teacher 三组接口
frontend/
  index.html           登录 / 注册
  practice.html        练习页结构（软键盘、题目/解析面板）
  css/practice.css     练习页样式
  js/
    math-core.js       多项式解析、展开、格式化；有理数系数（纯计算）
    engine-simplify.js 整式化简：出题、判题、分步解析、提示
    practice.js        渲染、键盘、缓存、上报
  teacher.html         教师看板
  vendor/              katex、mathjs 及字体（离线可用）
test/
  engine.test.js       出题/判题引擎穷举验证
  fraction.test.js     分数系数：有理数运算、解析、判等、步骤、判卷
  ui.smoke.js          练习页交互冒烟（自建最小 DOM 桩）
  auth.smoke.js        登录注册页冒烟
  teacher.smoke.js     看板冒烟
  api.test.js          接口测试（真实起服务 + 临时数据目录）
```


## 本地跑

需要 Node.js ≥ 20，只依赖 Express。

```bash
npm install
npm start          # http://localhost:3000
```

首次启动自动建库。老师注册需要管理员口令，未设置 `TEACHER_INVITE` 时任何人都不能注册老师：

```bash
# Linux / macOS
TEACHER_INVITE=换成你自己的口令 npm start

# Windows PowerShell
$env:TEACHER_INVITE='换成你自己的口令'; npm start
```

其他环境变量见 `.env.example`。

## 测试

```bash
npm test
```

六个套件串行执行，任一失败即非 0 退出：

| 套件 | 覆盖内容 |
|---|---|
| `engine.test.js` | 直接加载 `math-core.js` + `engine-simplify.js`，出题/判题/解析穷举断言，含分数题标签与步骤、④ 档 x/y 双变量（约 23830 条） |
| `fraction.test.js` | 分数系数：有理数规范化/四则/乘方、解析、格式化、判等、分步解析、判卷、四档随机分数题生成，以及上下分式 LaTeX 转换（约 3360 条） |
| `ui.smoke.js` | 加载 `practice.js`：渲染、提示、答对/错两次/看解析的解析展示、锁键盘、下一题、分数标签与 `/` 输入、`x`/`y` 斜体键与「清空」键 |
| `auth.smoke.js` | 登录注册页：角色切换、字段可见性、提交字段名、跳转 |
| `teacher.smoke.js` | 看板渲染、分数列/汇总卡/明细标签与详情切换 |
| `api.test.js` | 53 条接口断言（真实起服务 + 临时数据目录），含 tags 过滤/去重与分数统计 |

页面测试用最小 DOM 桩跑 Node，不需要浏览器；加载 `frontend/js/practice.js` 和 `frontend/vendor/math.js`，与浏览器实际一致。

> 分数系数题已接入练习页：软键盘有 `/`，②-④ 会随机混入分数题并带「分数」标签；分数表达式在题目、输入和解析中按上下分式显示。教师看板按标签单独统计分数题（正确率只算独立做对/做错，提示与看解析不计入）。
>
> ④ 挑战档统一用 `x`、`y` 两个字母（分数题同样如此）。改版前生成、已存档的 `a`/`b` 题仍能正常显示和判分——`math-core.js` 的变量顺序是 `x`、`y`、`a`、`b`，后两个只为兼容旧记录保留。

## 部署

见 [DEPLOY.md](DEPLOY.md)：镜像与 compose、更新与回滚、备份、反向代理与 HTTPS、常见故障排查。

## 主要接口

```
GET  /api/health
POST /api/auth/register      { name, password, role, inviteCode?, teacherInvite? }
POST /api/auth/login         { name, password }
POST /api/auth/logout
GET  /api/auth/me
POST /api/attempts           { clientId, level, question, answer, studentAnswer,
                               result, usedHint, revealed, tags?, ms }
GET  /api/attempts/mine?limit=20
GET  /api/teacher/students
GET  /api/teacher/attempts?studentId=...&limit=100
POST /api/teacher/students   { name, password }
```

`result` 取值 `correct` / `wrong` / `partial` / `error`；`tags` 目前只接受 `fraction`（用于区分分数系数题，未知标签会被静默丢弃）；带同一个 `clientId` 重复上报只记一次。
所有响应统一为 `{ success: true, data }` 或 `{ success: false, msg }`。

## 说明

个人教学用途，未做开源授权。题库与判题逻辑在 `frontend/js/engine-simplify.js`（基础多项式在 `math-core.js`），页面交互在 `frontend/js/practice.js`。
