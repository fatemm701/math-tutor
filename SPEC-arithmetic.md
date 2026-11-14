# 口算训练（口算 / 速算）—— 实施规格（SPEC）

> 这份是「口算训练」新练习的**唯一接口契约**。引擎、页面、后端、看板、测试四个方向并行开发，
> 所有行为以本文件为准；有疑问先按本文实现，再在 PR / 提交说明里标注。
> 项目仓库根：`E:\Files\017-Program\poly-drill`

## 0. 分档设计（已定）

| 档 | 名称 | 内容 | 题面示例 |
|---|---|---|---|
| ① | 入门 | **百以内正负数加减法**。绝对值 ≤ 99，三项连算式 `a + b - c`，结果不强制为正 | `-17 + 42 - 35` |
| ② | 基础 | 在①基础上**加入分数加减法**（分数与整数混合、异分母通分、取值范围落在百以内） | `3/4 + 1/2 - 1/8`、`5 - 2/3` |
| ③ | 进阶 | 在②基础上**加入乘法**（含负数乘除、分数乘除约分、小数乘除） | `(-7) × 8 + 3`、`3/4 × 2/3`、`1.5 × 4 − 2.5` |
| ④ | 挑战 | **混合运算与简算**：带括号的优先级（`(a + b) × c`、`a ÷ (b − c)`）、分数连乘除、平方/立方、平方差 / 分配律的凑整简算 | `(3/4 − 1/6) ÷ 5/12`、`12 × 25 + 12 × 75`、`(-2)³ + 15 ÷ (-3)` |

**为什么第④档这样定（给用户看的分档说明）**

1. **前三档顺着「数的范围扩张」走**：整数正负 → 分数 → 乘法（负数乘除、约分、小数）。学生每升一档只多学一个新东西，坡度平缓，符合口算训练的练习曲线。
2. **第④档不继续「加数字」而是「加结构」**：口算最容易出错的地方从来不是数字变大，而是①先乘除后加减、②括号、③分数连乘连除的约分、④能不能看出简算。所以第四档考的是**运算顺序 + 简算意识**，这也是初中前必须过关的能力（`12 × 25 + 12 × 75` 一眼看出分配律，比硬算快得多）。
3. 平方 / 立方放进④，是因为它和「负数乘方符号」天然扣在一起（`(-2)³` 是 `-8`，`(-3)²` 是 `9`），正好补上①②③都没覆盖的符号规则。
4. 不设「除法带余数」「科学计数法」这类，避免和「函数/统计」章节抢练点；口算页保持**纯有理数运算**，答案永远是整数、分数或有限小数。

**软键盘打死不加 `/` 的问题**：①③④ 都有整数答案，`/` 只用于分式输入。为了不给学生多加一个键，答案输入用下面这条规则（与项目既有 `math-core` 的有理数口径一致）：

> **填空规则**：答案写成一个值即可，**分数写 `3/4`**（`/` 键在所有档都有），**小数写 `0.75`** 也算对（自动换成分数比较）；
> 带分数（`1又1/2`）不支持，请写成假分数 `3/2`；负数直接写 `-5`。

## 1. 文件与写入边界（写作用 dir 互不重叠）

| 文件 | 谁写 | 说明 |
|---|---|---|
| `frontend/js/arith-engine.js` | **engine（math-drill）** | 新建：出题/判题/解析/提示/LaTeX |
| `test/math-drill.test.js` | **engine（math-drill）** | 新建：引擎自检 |
| `backend/scoring.js` | **backend（api）** | 改：`TOPICS` 加 `arithmetic`，增 `isArithmetic` |
| `backend/routes/attempts.js` | **backend（api）** | 改：`TOPICS` 加 `arithmetic`，`TAGS` 加 `decimal` |
| `test/api.test.js` | **backend（api）** | 改：新增口算题断言 |
| `frontend/math.html` | **page（web）** | 新建：口算练习页 |
| `frontend/js/math-drill-page.js` | **page（web）** | 新建：页面渲染/键盘/缓存/上报 |
| `frontend/css/math-drill.css` | **page（web）** | 新建：样式（复用 practice.css 的变量） |
| `test/ui.smoke.js` | **page（web）** | 改：新增「口算页」一节 |
| `frontend/practice.html` `equations.html` `index.html` `teacher.html` | **nav-board（surfaces）** | 改：侧边栏加「口算训练」；teacher.html 加题型统计 |
| `test/nav.smoke.js` | **nav-board（surfaces）** | 改：导航链接清单加口算项 |
| `test/asset-version.test.js` | **nav-board（surfaces）** | 改：`pages` 加 `math.html` |
| `test/teacher.smoke.js` | **nav-board（surfaces）** | 改（可选，不破坏现有断言） |
| `README.md` `package.json` | **nav-board（surfaces）** | 改：文档、`npm test` 串口算套件 |
| `frontend/js/quadratic-roots.js` | Lead | 未跟踪的遗留文件，已提交 |
| `SPEC-arithmetic.md` | Lead | 本文件 |

任何人不得改「没有写自己名字」的文件。需要跨文件改动时在提交说明里写明、由 Lead 合并。

## 2. 引擎 API（`frontend/js/arith-engine.js`）

与项目其它引擎同构：**IIFE，不碰 DOM / KaTeX / 网络 / localStorage**，Node 端 `require`，浏览器端挂到 `window.ArithEngine`。

```js
function createArithEngine(math, core) { ... return api; }
module.exports = createArithEngine;                       // Node
global.ArithEngine = createArithEngine(global.math, global.MathCore);   // 浏览器
```

### 2.1 必要的导出

```js
{
  LEVELS: [1, 2, 3, 4],
  LEVEL_NAMES: ['入门', '基础', '进阶', '挑战'],
  generateQuestion(level) -> {
      level: 1..4,
      question: string,      // 题面，如 "-17 + 42 - 35"
      answer: string,        // 标准答案，规范形式：整数 "25" / 分数 "-3/4" / 小数兜底时用分数
      tags: string[],        // 可含 'fraction' 与/或 'decimal'
      kind: string,          // 供提示与难度说明：'add-sub' | 'fraction' | 'multiply' | 'mixed'
      ops: string[]          // 本题出现过的运算符，如 ['+', '-', '*', '()', '^']，供测试与看板
  },
  evaluateAnswer(studentInput, correctAnswer) -> {
      status: 'correct' | 'wrong' | 'error',
      msg: string            // 给学生的中文提示
  },
  buildSteps(question, answer) -> [{ title, expr }],   // 至少 2 步，末步 expr 数值等于 answer
  hintsFor(question) -> string[],                      // 1~3 条中文提示
  toLatexText(text) -> string|null,                    // 纯文本算式 -> KaTeX 字符串
  valueOfExpr(text) -> rational      // 纯文本算式解析并求值（{s,n,d}），非法抛错（测试、判题都会用）
}
```

### 2.2 题面（`question`）书写约定

- 只用 ASCII 与下面这些符号：数字、`+`、`-`、`*`（**乘号统一写 `*`**，渲染成 `×` 由 `toLatexText` 负责）、`/`（分数线 / 除号，**统一写 `/`**）、`.`（小数）、`(`、`)`、`^`、空格。
- **负数用括号包起来**出现在运算符后面：`(-7) * 8 + 3`、`12 - (-5)`；题面开头若是负数可直接写 `-17 + 42`（题面不允许出现连续符号 `+-` / `--` / `*-`）。
- `/` 同时表示分数和除号，解析上等价：`3/4 + 1/2` 是分数加法，`56/8 + 3` 是整数除法，两者都按除法求值，教学上不影响。
- 乘号：`*`；平方：`^2`，立方：`^3`；幂的底数是负数/分数/括号时必须带括号：`(-2)^3`、`(3/4)^2`。
- 结果**不允许是负数分数写成带号分母**：规范化输出 `-3/4`，不写 `3/-4`。
- 小数只允许一位或两位（`0.5`、`1.25`、`2.75`），不用科学计数法。
- 答案范围：绝对值 ≤ 2000，分子分母 ≤ 400，保证学生手算合理。

### 2.3 判题口径 `evaluateAnswer`

1. 输入先 trim、去空白、全角转半角（`（）＋－×÷` 等）；空串 → `error`。
2. 允许的写法：整数 `-5`、小数 `-0.75`、分数 `3/4`、`-3/4`、带括号 `(-3)/4`、化简前 `6/8`（会约分后比较）。
3. 数值完全相等 → `correct`（`0.75` 与 `3/4` 等价，`2` 与 `4/2` 等价）。
4. 写了完整算式且数值正确（`12+3` 对 `15`）→ `correct`，但 `msg` 里附一句「对，口算题建议直接写结果」。
5. 数值不等 → `wrong`；解析失败（含字母、非法字符、多个等号、`1又1/2` 带分数）→ `error`，`msg` 告诉学生「答案只能是一个数，分数写 3/4，小数写 0.75」。
6. **绝不抛异常**：所有解析错误都折成 `status:'error'`。

### 2.4 分步解析 `buildSteps`

- 固定按「原式 → 按运算顺序（先乘除后加减）拆步 → 各步结果 → 答案」推进，`title` 用中文短语，如 `原式`、`先算乘法`、`再算加减`、`通分`、`约分`、`结果`。
- 每一步 `expr` 都是**值相等的等价变形**；末步 `expr` 数值 == `answer`。
- 分数题必须出现一步「通分」或「约分」，让学生看到“为什么”。④ 档的简算题必须出现一步「用分配律」/「凑整」。
- 步骤 2~6 条，不刷屏。

### 2.5 提示 `hintsFor`

- 按题面结构给，1~3 条，不给答案：
  - 有括号 → 「先算括号里的」
  - 有乘除 → 「先乘除、后加减」
  - 有负数相乘 → 「负负得正」
  - 分数异分母 → 「先通分再加减」
  - 分数相乘 → 「分子乘分子、分母乘分母，能约分先约分」
  - ④ 档能简算的 → 「找找有没有能凑整的，比如把 12 提出来」

## 3. 页面契约（`frontend/math.html` + `frontend/js/math-drill-page.js`）

### 3.1 `math.html`

- `<title>口算训练</title>`，结构与 `equations.html` **同构**：同一段侧边栏（多一个口算链接）、`#level-tabs` 四档按钮、`.display-board`、`#question-display` `#input-display` `#feedback-display` `#hint-display` `#steps-display` `#q-tag`、`.keyboard#keyboard`、页尾脚本。
- 引用：`vendor/katex/katex.min.css`、`css/practice.css`、`css/app-nav.css`、`css/math-drill.css`（本页专用，**必须放在 practice.css 之后**）、`vendor/katex/katex.min.js`、`vendor/math.js`、`js/arith-engine.js`、`js/app-nav.js`、`js/math-drill-page.js`。所有本地 css/js 都带 `?v=<版本号>`，与其它四页保持一致的值（Lead 最后统一 stamp）。
- 侧边栏「练习」分组里加一条：
  ```html
  <a class="app-nav-link" href="math.html" data-nav="arithmetic" aria-current="page">
      <span class="app-nav-icon" aria-hidden="true">±</span>
      <span class="app-nav-text">口算训练</span>
  </a>
  ```
  顺序：整式化简、一元一次方程、**口算训练**。
- 软键盘（`data-val` 用字符；**不要字母键、不要 `^2`/`^3`**，口算要的是结果不是式子）：5 列 3 行数字键 + 1 行动作键：

  ```
  7  8  9  +  -
  4  5  6  *  /
  1  2  3  .  (
  0  )  清空  提示  看解析        ← 清空/提示/看解析也可放在最底行，样式自行安排
  退格  提交答案（.key.submit 占 4 列）
  ```
  **硬性要求**：键必须覆盖 `0-9`、`+` `-` `*` `/` `.` `(` `)`；动作键 `清空 / 退格 / 提示 / 看解析 / 提交` 齐全（`data-action` 分别为 `clear / backspace / hint / giveup / submit`，提交键带 `.key.submit` 且 `data-action="submit"`）；不得出现 `x` `y` `^2` `^3`。列宽/跨列在 `css/math-drill.css` 里调，不要改 practice.css。

### 3.2 `math-drill-page.js`

- IIFE `(function (window) {...})(window)`，`window.onload = async () => {...}`，取 `window.ArithEngine`，缺失时 `console.error('[poly-drill] 口算引擎未加载')` 并直接 return（与 practice-equations.js 一致）。
- 复用 `practice-equations.js` 的骨架：KaTeX 渲染（失败退化成 HTML）、夜间模式（键 `poly-theme`）、错 1 次只提示/错 2 次给解析、`看解析` 需 confirm、结束后锁键盘只剩「下一题」。
- **缓存键**：`arith_current_q:<userId>`，TTL 30 分钟，`isValidQuestion` 校验 `question/answer` 是字符串且 level ∈ 1..4。
- **上报**：
  ```js
  { topic: 'arithmetic', clientId, level, question, answer, studentAnswer,
    result, usedHint, revealed, gaveUp, tags: ['fraction'?, 'decimal'?],
    ms }
  ```
  `result` 只用 `correct` / `wrong` / `error`（口算只有对错和格式错，不用 parentheses/unmerged）。
- 页面顶部 `#level-label` 里显示当前档名，分数题显示「分数」标签（`#q-tag`，复用 `.tag.tag-fraction`），小数题显示「小数」标签（新 class `.tag-decimal`，写在 math-drill.css）。
- 难度说明：`#level-tabs` 下加一行小字，随档切换，文案：
  1. 百以内正负数加减
  2. 加入分数加减
  3. 加入乘除（含负数、分数、小数）
  4. 混合运算与简算（括号、乘方、凑整）
- 各档按钮文案：`① 入门 / ② 基础 / ③ 进阶 / ④ 挑战`（与其它页一致）。
- 键盘日志、页面初始化失败提示（`showBootError`）与方程页一致。

## 4. 后端契约

- `backend/scoring.js`
  - `TOPICS = ['simplify', 'equation', 'arithmetic']`
  - `summarize()` 的 `stats.byTopic` 自动多出 `arithmetic` 一张表（结构同其它两张）。
  - `buildCounts()` 计数叶子在原有 `{ fraction, integer, equation, equationFraction }` 之外**新增** `arithmetic` 与 `arithmeticFraction`（`arithmeticFraction` 是 `arithmetic` 的子集，含义同 `equationFraction`）。
  - **口算题不落 `fraction` / `integer` / `equation` 任何一个字段**，`counts` 各叶节点恒等式：
    `全部 = fraction + integer + equation + arithmetic`，`分数题 = fraction + equationFraction + arithmeticFraction`。
- `backend/routes/attempts.js`
  - `TOPICS` 加 `'arithmetic'`；`TAGS` 加 `'decimal'`（用于小数题统计，可只做透传）。
  - 其余不变（`level` 仍只接受 1..4，`question` ≤ 300 字符）。
- `test/api.test.js`：新增段落验证 `topic:'arithmetic'` 的上报、`byTopic.arithmetic`、`counts` 恒等式、`decimal` 标签透传、未知 topic 仍回落 simplify。

## 5. 看板契约（`frontend/teacher.html`，nav-board 同学）

- 「题型」筛选 chips 由 `全部 / 分数题 / 整数题 / 方程题 / 化简题` 变为
  `全部 / 分数题 / 整数题 / 方程题 / 化简题 / 口算题`（key 依次 `''/fraction/integer/equation/simplify/arithmetic`）。
- `countsOfFilter` 里 `arithmetic` 走 `cell.arithmetic`；「全部」加上 `arithmetic`；「分数题」加上 `arithmeticFraction`；「化简题」不变（`fraction + integer`）。
- 汇总卡新增一张「口算题」：总数 + 正确率，数据来自 `stats.byTopic.arithmetic`（老响应没有就当没做过）。
- 明细「题型」列：`topic === 'arithmetic'` 显示「口算」。
- **现有断言不能破坏**：`test/teacher.smoke.js` 里 chips 顺序断言（`'/fraction/integer/equation/simplify'`）需要由 nav-board 同学同步更新为带 `arithmetic` 的新顺序。

## 6. 测试口径

- `npm test` 串行跑；新增 `test/math-drill.test.js`（引擎）必须在 `test/ui.smoke.js` 之前。
- 引擎测试要求：四档各 300 道随机题，断言 level/题面字符集/标签与题面一致/答案规范/`buildSteps` 末步等于答案且步数 ≥ 2/`hintsFor` 非空且不含答案/判题分支（正确、约分等价、小数等价、算式等价、错、格式错、全角输入）。
- 页面冒烟：模拟键盘输入 → 提交 → 反馈 → 错两次出解析 → 下一题 → 上报 payload 带 `topic:'arithmetic'`。

## 7. 版本号与提交

- 改了 css/js 的提交者**不要**自己跑 `npm run stamp`（四页会被同时改脏、和别人的改动冲突）。Lead 在所有人都完成后统一执行：
  ```powershell
  $env:ASSET_VERSION='20261114'; npm run stamp
  ```
- 所有人完成后由 Lead 跑 `npm test`，通过后统一提交。