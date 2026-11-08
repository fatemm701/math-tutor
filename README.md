# 整式化简练习（poly-drill）

给初中生练「整式化简」的网页工具：**出题、判题、分步解析全在浏览器里跑**，服务端只负责登录、存档和统计。
一台 256MB 内存的小机器就能跑（Docker 单容器，常驻约 60MB）。

## 功能

**练习页** `frontend/practice.html`

- 4 个难度：① 入门 / ② 基础 / ③ 进阶 / ④ 挑战，题目按「去括号 → 合并同类项」的结构生成
- 物理键盘 + 屏幕软键盘，支持 `x` `a` `b` `^2` `^3`
- 答对立刻给完整推导；答错 2 次、或点「看解析」也给推导，并附一行「你的答案」对照
- 答错、用提示、直接看解析分开计数（后两类不计入正确率）

**教师看板** `frontend/teacher.html`

- 汇总卡片 + 学生表格：题数、正确率、错题数、用提示数、看解析数、平均用时、最后活跃、四档分布
- 点学生看最近 100 条明细
- 添加学生账号；「我自己」面板单独统计老师本人的练习，不混入学生数据

**账号**

- 口令用 scrypt 加盐哈希，会话走随机 session id + HttpOnly Cookie
- 老师凭环境变量里的管理员口令注册，注册成功拿到 6 位邀请码；学生填邀请码后自动挂到该老师名下
- 登录失败按 IP 限速

## 技术栈

| 层 | 实现 |
|---|---|
| 前端 | 单文件 HTML + 原生 JS；判题/解析引擎内联在 `practice.html`；KaTeX、mathjs 放在 `frontend/vendor/`，**不依赖 CDN** |
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
  practice.html        练习页（判题与解析引擎在这里）
  teacher.html         教师看板
  vendor/              katex、mathjs 及字体（离线可用）
test/
  engine.test.js       出题/判题引擎穷举验证
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

五个套件串行执行，任一失败即非 0 退出：

| 套件 | 覆盖内容 |
|---|---|
| `engine.test.js` | 出题 + 判题 + 解析引擎穷举断言（约 17747 条） |
| `ui.smoke.js` | 练习页交互：渲染、提示、答对/错两次/看解析的解析展示、锁键盘、下一题 |
| `auth.smoke.js` | 登录注册页：角色切换、字段可见性、提交字段名、跳转 |
| `teacher.smoke.js` | 看板渲染与详情切换 |
| `api.test.js` | 47 条接口断言（真实起服务 + 临时数据目录） |

页面测试用最小 DOM 桩跑 Node，不需要浏览器；加载的是 `frontend/vendor/math.js`，和浏览器实际用的是同一份。

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
                               result, usedHint, revealed, ms }
GET  /api/attempts/mine?limit=20
GET  /api/teacher/students
GET  /api/teacher/attempts?studentId=...&limit=100
POST /api/teacher/students   { name, password }
```

`result` 取值 `correct` / `wrong` / `partial` / `error`；带同一个 `clientId` 重复上报只记一次。
所有响应统一为 `{ success: true, data }` 或 `{ success: false, msg }`。

## 说明

个人教学用途，未做开源授权。题库与判题逻辑在 `frontend/practice.html` 内联维护。
