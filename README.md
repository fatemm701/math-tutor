# 整式化简练习（poly-drill）

给初中生练「整式化简 / 一元一次方程 / 口算」的网页工具：**出题、判题、分步解析全在浏览器里跑**，服务端只负责登录、存档和统计。
一台 256MB 内存的小机器就能跑（Docker 单容器，常驻约 60MB）。

## 功能

**练习页** `frontend/practice.html`（结构）+ `frontend/js/practice.js`（交互）

- 4 个难度：① 入门 / ② 基础 / ③ 进阶 / ④ 挑战，题目按「去括号 → 合并同类项」的结构生成
- ①②③ 只用一个字母 `x`；④ 挑战用 `x`、`y` 两个字母，考「xy、x²、y² 各算一类」
- ②-④ 按比例混入分数系数题（L2 25%、L3 40%、L4 50%），题目标「分数」标签；① 保持整数题
- 物理键盘 + 屏幕软键盘，支持 `x` `y` `^2` `^3` 和分数线 `/`（如 `1/2x + 3/4`）；屏幕上的字母键用数学斜体，和乘号 `×` 区分开
- 左侧导航栏底部的 🌙 可切换夜间模式（深灰底，暗光下/调试时更舒服），选择记在本机浏览器，练习页和看板共用同一个开关
- 分数题用 KaTeX 上下分式（`\dfrac`）显示，整数题保持原写法
- 答对立刻给完整推导；答错 2 次、或点「看解析」也给推导，并附一行「你的答案」对照
- 判卷分「独立对 / 提示后对 / 提示后错 / 错 / 没化简完（没去括号、没合并同类项）/ 格式错 / 看解析」几档
- 计分口径：看了提示仍算对（没给答案），主动点「看解析」算错；答错两次后自动弹出解析不算「看解析」

**一元一次方程练习** `frontend/equations.html`（结构）+ `frontend/js/practice-equations.js`（交互）

- 与整式化简是两个独立页面，从左侧导航栏的「练习」分组里切换（两套引擎互不干扰，缓存也各存各的）
- 4 个难度：① 入门 `x + a = b`、`a − x = b`、`ax = b`；② 基础未知数在两边 `ax + b = cx + d`；③ 进阶带括号 `a(x + b) = c(x + d)`、`a(x + b) + c = dx + e`；④ 挑战必须带数字分母（`(x ± a)/m`、`1/2(x + 3)` 等）
- 分步解析固定按「去分母 → 去括号 → 移项 → 合并同类项 → 化系数为一」推进，每一步都是等价变形，并附一句这步在做什么（如「两边同乘 6」「移过去的项要变号」）
- 判题：任意等价写法都算对（`x = 4`、`4`、`4 = x`、`x = 2/4` 都行）；同解但没化到 `x = …`（如写 `2x = 8`）判「对，但还没化系数为一」；小数、语法错按格式错处理
- 提示按题面结构给：有分母先讲去分母、有括号讲变号、未知数在两边讲移项
- 软键盘与化简页一致，多一个 `=` 键；分数同样用上下分式显示

**口算训练** `frontend/math.html`（结构）+ `frontend/js/math-drill-page.js`（交互）

- 与上两个练习并列的第三个独立页面，从左侧导航栏的「练习」分组里切换（引擎是 `frontend/js/arith-engine.js`，与前两套互不干扰，缓存也各存各的）
- 4 个难度：
  - ① 入门 百以内正整数的加减（两三个数连加连减，一律带负号训练，如 `-34 - (-19) - (-53)`）
  - ② 基础 在①的基础上加分数加减（同分母/分母成倍数、先通分，如 `5/6 + 11/12 + (-3)`）
  - ③ 进阶 在②的基础上加乘法（含负数乘除、分数乘除、小数乘整数，如 `(-15) * 4 / 3`、`3/8 / (1/2)`）
  - ④ 挑战「混合运算与简算」：括号与运算顺序、乘方（`(-2)^3`）、分配律与平方差凑整（`(41)^2 - (5)^2`、`(1/2 - 1/6) * (-5)`）
- ④ 档定为「混合运算与简算」而不是继续堆大数：前三档按「数的范围」逐步扩张（整数 → 分数 → 乘除），第④档换成按「结构」出题，考的是**先算哪一步、用哪条运算律**——口算真正的失分点在这里，而不是数字更吓人；大数字只会拖慢节奏、把口算练成笔算，所以题面数字始终在能心算的范围里
- 软键盘只有数字和运算键（没有字母键），分数与小数用键盘直接敲
- 填空判题：同一个值怎么写都算对——分数写 `3/4`、小数写 `0.75`（`0.75`/`.75` 都行）等价；结果能约分时写 `6/8` 也判对，但会提示「还能约分」；宽严口径与另外两页一致（格式错不算对，不算「看解析」）

**教师看板** `frontend/teacher.html`

- 汇总卡片 + 学生表格：题数、正确率（提示算对、看解析算错）、独立做对数、提示后对数、错误数、用提示数、看解析数、平均用时、最后活跃、四档分布、分数题正确/总数、方程题正确/总数、口算题正确/总数
- 列表页与明细页都有筛选条：按结果（独立对/提示后对/提示后错/错/没化简完/格式错/看解析）、难度、题型（分数题/整数题/方程题/化简题/口算题）、时间（今天/最近 7 天/全部）组合筛选，再点一次同一项取消
- 点学生看最近 100 条明细（明细里带「题型」列，能分清是化简、方程还是口算）
- 添加学生账号；「我自己」面板单独统计老师本人的练习，不混入学生数据

**学生自查**（同一页 `frontend/teacher.html`，左侧导航栏的「看板 / 我的看板」对登录用户都可见）

- 学生点「我的看板」只看自己的「我的练习」：和老师看板同一套口径的汇总卡、同样的筛选条、一句「哪档练得多、哪档还没碰」的提示、最近 100 条明细
- 数据只来自 `GET /api/attempts/mine/summary`（服务端只认当前会话，不接受任何 userId 参数），学生拿不到其他学生的任何数据，也看不到添加学生表单
- 老师打开时仍是原来的看板（学生列表 + 明细 + 添加学生 + 「我自己」）

**账号**

- 口令用 scrypt 加盐哈希，会话走随机 session id + HttpOnly Cookie
- 老师凭环境变量里的管理员口令注册，注册成功拿到 6 位邀请码；学生填邀请码后自动挂到该老师名下
- 登录失败按 IP 限速

## 技术栈

| 层 | 实现 |
|---|---|
| 前端 | 页面 + 模块化原生 JS；基础多项式在 `frontend/js/math-core.js`，括号树在 `frontend/js/poly-tree.js`，两套题型引擎分别是 `frontend/js/engine-simplify.js`（整式化简）和 `frontend/js/equation-engine.js`（一元一次方程），口算是 `frontend/js/arith-engine.js`，渲染与交互在 `frontend/js/practice.js` / `frontend/js/practice-equations.js` / `frontend/js/math-drill-page.js`；KaTeX、mathjs 放在 `frontend/vendor/`，**不依赖 CDN** |
| 后端 | Node.js 22 + Express 5，只做静态托管 + 认证 + 记录读写，**不做数学计算** |
| 存储 | 单个 JSON 文件 `data/db.json`（先写临时文件再 rename，原子替换；无文件锁，只支持单实例） |
| 部署 | Docker / Docker Compose，非 root（uid 1000）运行，内置 healthcheck |

**左侧导航栏**（五个页面共用 `frontend/css/app-nav.css` + `frontend/js/app-nav.js`，HTML 各页各写一份）

- 常驻 220px，点 ☰ 收起成 60px 只留图标，状态记在本机浏览器；窄屏（≤768px）自动变成抽屉，点遮罩或点链接就关
- 「练习」分组可折叠（以后加新练习类型就往这里加），分组开合状态也记住
- 当前所在页面自动高亮（`aria-current`）；登录后看板入口才出现，学生的叫「我的看板」；未登录时入口全部置灰、底部换成「登录」
- 增新页面只需复制这段侧边栏 HTML、给新链接加 `data-nav`，脚本会按文件名自动高亮；`test/nav.smoke.js` 会守住这一点

## 目录

```
backend/
  server.js            Express 入口、静态托管、/api/health
  auth.js              scrypt 哈希、会话、登录限速
  store.js             db.json 读写（原子写）
  scoring.js           计分口径与筛选计数（老师看板与学生自查共用）
  routes/              auth / attempts / teacher 三组接口
frontend/
  index.html           登录 / 注册
  practice.html        整式化简练习页结构（软键盘、题目/解析面板）
  equations.html       一元一次方程练习页结构
  math.html            口算训练页结构
  css/practice.css     练习页样式（两个练习页共用）
  css/math-drill.css   口算训练页样式
  css/app-nav.css      左侧导航栏样式（五个页面共用，含夜间模式与窄屏抽屉）
  js/
    math-core.js       多项式解析、展开、格式化；有理数系数（纯计算）
    poly-tree.js       「项 -> 括号 -> 项」树：去括号、合并同类项（两套引擎共用）
    engine-simplify.js 整式化简：出题、判题、分步解析、提示
    equation-engine.js 一元一次方程：出题、判题、分步解析、提示
    arith-engine.js    口算训练：出题、数值判等（分数/小数）、简算提示（纯计算）
    practice.js        化简页渲染、键盘、缓存、上报
    practice-equations.js 方程页渲染、键盘、缓存、上报
    math-drill-page.js 口算页渲染、键盘、缓存、上报
    app-nav.js         左侧导航：收起/分组记忆、窄屏抽屉、当前页高亮、按角色显示看板入口
  teacher.html         教师看板
  vendor/              katex、mathjs 及字体（离线可用）
test/
  engine.test.js       出题/判题引擎穷举验证
  fraction.test.js     分数系数：有理数运算、解析、判等、步骤、判卷
  equation.test.js     一元一次方程：出题质量、分步解析、判题、提示
  math-drill.test.js   口算训练：四档出题范围、分数/小数判等、简算题答案、填空校验
  ui.smoke.js          练习页交互冒烟（自建最小 DOM 桩）
  nav.smoke.js         左侧导航冒烟（收起/分组记忆、窄屏抽屉、当前页高亮、访客与登录态）
  auth.smoke.js        登录注册页冒烟
  teacher.smoke.js     看板冒烟
  asset-version.test.js 页面资源版本号自检（五个页面的 css/js 都带 ?v=提交号）
  api.test.js          接口测试（真实起服务 + 临时数据目录）
scripts/
  stamp-assets.js      给五个页面的本地 css/js 引用打上 ?v=<提交号>
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

十一个套件串行执行，任一失败即非 0 退出：

| 套件 | 覆盖内容 |
|---|---|
| `engine.test.js` | 直接加载 `math-core.js` + `poly-tree.js` + `engine-simplify.js`，出题/判题/解析穷举断言，含分数题标签与步骤、④ 档 x/y 双变量（约 23830 条） |
| `fraction.test.js` | 分数系数：有理数规范化/四则/乘方、解析、格式化、判等、分步解析、判卷、四档随机分数题生成，以及上下分式 LaTeX 转换（约 3360 条） |
| `equation.test.js` | 一元一次方程：四档随机题的题面质量与解的唯一性（④ 档必含分母）、分步解析逐步同解且末步为 `x = 答案`、固定样例步骤、判题分支（含 `x = -3` 负数解、`2x = 8` 判「没化系数为一」、小数/语法错）、提示分类、`toLatexText` 带等号 |
| `math-drill.test.js` | 口算训练：四档随机题的数值范围（① 百以内正负数加减、② 加分数、③ 加乘除、④ 混合运算与简算）、分数与小数等价判等（`3/4` = `0.75`）、约分提示、非法填空按格式错、简算题的凑整/分配律答案 |
| `ui.smoke.js` | 加载 `practice.js` 与 `practice-equations.js`：渲染、提示、答对/错两次/看解析的解析展示、锁键盘、下一题、分数标签与 `/` 输入、`x`/`y` 斜体键与「清空」键、等号键、夜间模式开关（默认亮色、切换、记住、重进恢复） |
| `nav.smoke.js` | 加载 `app-nav.js`：宽屏收起/展开并记住、练习分组折叠并记住、窄屏点 ☰ 开合抽屉（点遮罩或点链接自动关、不写 localStorage）、缩放窗口后两种形态互切、当前页 aria-current、访客态置灰且不请求接口、登录后按角色显示看板入口（学生「我的看板」/ 老师「看板」）、没有侧边栏的页面与 localStorage 被禁用时不抛错 |
| `auth.smoke.js` | 登录注册页：角色切换、字段可见性、提交字段名、跳转 |
| `teacher.smoke.js` | 老师的看板渲染、分数列/方程列/口算列/汇总卡/明细标签与详情切换、列表与明细筛选（含题型）、夜间模式开关；学生进来看到的「我的练习」汇总/筛选/明细/返回 |
| `asset-version.test.js` | 五个页面引用的 `css/*.css`、`js/*.js` 都带 `?v=` 版本号、五页版本号一致、且等于当前提交号（`vendor/` 的第三方资源不要求） |
| `page-assets.test.js` | 五页的 `<script>`/`<link>` 依赖顺序（引擎之前必须轮到它的上游文件）、引用的文件真实存在、`<main>` 之前 `<div>` 闭配平——专门防「漏加载一个脚本，单测全绿、线上整页空白」 |
| `api.test.js` | 181 条接口断言（真实起服务 + 临时数据目录），含 tags 过滤/去重、分数统计、`topic` 题型统计与 `byTopic` 归类（含 `arithmetic`）、只读自己汇总的越权防护 |

页面测试用最小 DOM 桩跑 Node，不需要浏览器；加载 `frontend/js/practice.js`（或 `practice-equations.js`）和 `frontend/vendor/math.js`，与浏览器实际一致。

还有一个**真浏览器**冒烟，不进 `npm test`（需要本机 Chrome/Edge，跑得慢）：

```bash
npm start                     # 先起服务（默认 3000 端口）
npm run smoke:browser         # 用 headless Chrome 打开口算页，验引擎挂载、题面、键盘输入、判题、下一题
```

口算页要登录，没给 cookie 时脚本会打印「跳过」并以 0 退出；想跑完整链路就把浏览器里登录后的 `pd_sid` 通过 `SMOKE_COOKIE="pd_sid=..."` 传进去（可配合 `BASE=http://127.0.0.1:3199` 指向别的端口）。

> 分数系数题已接入练习页：软键盘有 `/`，②-④ 会随机混入分数题并带「分数」标签；分数表达式在题目、输入和解析中按上下分式显示。教师看板按标签单独统计分数题（正确率按「提示算对、看解析算错」计算）。
>
> ④ 挑战档统一用 `x`、`y` 两个字母（分数题同样如此）。改版前生成、已存档的 `a`/`b` 题仍能正常显示和判分——`math-core.js` 的变量顺序是 `x`、`y`、`a`、`b`，后两个只为兼容旧记录保留。
>
> 一元一次方程页的题目同样只用一个字母 `x`；判题时学生写 `x = 4`、`4`、`4 = x`、`x = 8/2` 都算对（小数也可以，会先换成分数再比），写成 `2x = 8` 这种同解但没化到 `x = …` 的形式会提示「还没化系数为一」。
>
> 口算训练页的填空按**数值**判等：分数写 `3/4`、小数写 `0.75` 都算对（`0.75` 与 `.75` 相同），负数直接带 `-` 号；结果没约到最简会提示「还能约分」。④ 档「混合运算与简算」练的是运算律（凑整、分配律、`99 × 7 = 700 − 7`），题面数字都在能心算的范围里。

## 静态资源版本号（改了 CSS/JS 后必须做）

五个页面引用本地样式和脚本时都带 `?v=<版本号>`，例如 `<link rel="stylesheet" href="css/app-nav.css?v=ce354981">`。
浏览器按 URL 缓存，换了版本号才会重新拉取，学生端不必手动强刷。
`vendor/`（KaTeX、mathjs）是第三方固定版本，不带版本号。

**只有改了 `frontend/css/*.css` 或 `frontend/js/*.js` 才需要推进版本号**，其他改动（后端、测试、文档）不用管。推进方式（吃饱一次，五页统一）：

```bash
ASSET_VERSION=20261109 npm run stamp     # 值随便取，只要与上次不同（日期最省心）
node scripts/stamp-assets.js --check     # 校验五页一致、格式合法
```

`npm run stamp` 本身是**幂等**的：不指定 `ASSET_VERSION` 时它沿用页面里已有的版本号，不会自动跳号
（原因是版本号若绑定提交号，提交会改哈希、版本号永远落后一步，每次提交都得改五个页面，很脏）。
所以规矩只有一条：**动过 css/js 就带上 `ASSET_VERSION=<新值>` 跑一次 `npm run stamp` 再提交**。
页面里写 `?v=manual-xxx` 也可以，`stamp` 会原样保留这种手动标记。

## 部署

当前生产环境已从「tar 包覆盖」切换为 **git 仓库 + `git pull`**（`/opt/poly-drill`，只读 Deploy key）。日常更新就三步：

```bash
cd /opt/poly-drill
git pull --ff-only
docker compose up -d --build
```

按上面的第 1、3 条改完版本号再提交推送，服务器拉下来就是新的；`data/` 与 `.env` 不在仓库里，不受影响。
镜像与 compose、回滚、备份、反向代理与 HTTPS、常见故障排查见 [DEPLOY.md](DEPLOY.md)。

`tools/` 是开发机专用的本地脚本（临时隧道等），已写进 `.gitignore` 与 `.dockerignore`，不进仓库、也不上传服务器。

## 主要接口

```
GET  /api/health
POST /api/auth/register      { name, password, role, inviteCode?, teacherInvite? }
POST /api/auth/login         { name, password }
POST /api/auth/logout
GET  /api/auth/me
POST /api/attempts           { clientId, level, question, answer, studentAnswer,
                               result, usedHint, revealed, tags?, topic?, ms }
GET  /api/attempts/mine?limit=20
GET  /api/attempts/mine/summary            只看自己的汇总 + 筛选计数（学生自查用）
GET  /api/teacher/students
GET  /api/teacher/attempts?studentId=...&limit=100
POST /api/teacher/students   { name, password }
```

`result` 取值 `correct` / `wrong` / `parentheses`（答案对但没去括号）/ `unmerged`（答案对但没合并同类项）/ `error`；旧客户端的 `partial` 写入时自动归到 `unmerged`。可选 `gaveUp: true` 表示学生主动点了「看解析」（用来把「看解析」和「错两次被动给解析」分开计分）。
`tags` 目前只接受 `fraction`（分数系数题）和 `decimal`（小数题，口算训练用），未知标签会被静默丢弃；带同一个 `clientId` 重复上报只记一次。
`topic` 取值 `simplify` / `equation` / `arithmetic`，用来区分整式化简、一元一次方程和口算训练；不传或传了未知值时按 `simplify` 统计（旧客户端和老数据自动落入这一档）。看板筛选计数 `counts[范围][结果][难度]` 的叶节点是 `{ fraction, integer, equation, equationFraction, arithmetic, arithmeticFraction }`：`fraction`/`integer` 只统计化简题，`equation` 是方程题总数，`equationFraction` 是其中带分数标签的子集，`arithmetic` 是口算题总数（不落进前三个字段），`arithmeticFraction` 是其中带分数标签的子集；`stats.byTopic` 则是按题型分开的完整统计（含 `byTopic.arithmetic`，老响应没有这个字段时看板按「没做过」显示）。
所有响应统一为 `{ success: true, data }` 或 `{ success: false, msg }`。

## 说明

个人教学用途，未做开源授权。题库与判题逻辑在 `frontend/js/engine-simplify.js`（整式化简）、`frontend/js/equation-engine.js`（一元一次方程）和 `frontend/js/arith-engine.js`（口算训练），基础多项式在 `math-core.js`，两套引擎共用的括号树在 `poly-tree.js`，页面交互在 `frontend/js/practice.js` / `frontend/js/practice-equations.js` / `frontend/js/math-drill-page.js`。
