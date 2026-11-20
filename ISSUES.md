# 反馈整理（GitHub Issues）

仓库 `fatemm701/math_train` 是私有仓库，**Discussions 未开启**（GraphQL `discussions.totalCount = 0`），
"讨论区"实际就是 3 条 open issue + 1 条已合并 PR。全部由仓库 owner 在 2026-11-14 自己提的，都没有评论。

拉取方式：`C:\Users\16078\AppData\Local\GitHubCLI\bin\gh.exe`（已 `gh auth login`，scopes 含 `repo`），
`gh api repos/fatemm701/math_train/issues/<n>`；截图附件需带 `Authorization: token <gh auth token>` 才能下载。

---

## #2 分数化简太简单了，更新模板

- 状态：open · 2026-11-14 04:30 · 0 评论 · 无正文、无截图
- 诉求解读：整式化简页的分数题（② 基础起 `FRACTION_RATE = {1:0, 2:0.25, 3:0.4, 4:0.5}`）形态太单一。

**结论：采纳。** 理由：

1. Lead 实测复现：「② 基础」连续抽 80 道分数题，骨架几乎只有一种——
   `整数 ± (p/q)(x ± a)`，答案一律是 `(p/q)x + 常数`，例如
   `9 + 1/2(x - 3)` → `x/2+15/2`、`1/6(x + 6) + 9` → `x/6+10`。
   学生做十几道之后就不再需要判断"先乘开还是先合并"，难度掉成纯算术。
2. 分数题的训练目标是「分配律 × 分数运算 × 符号规则同时进行」，模板单一就等于只练了其中一项。
3. 已确认这是**模板**问题而不是难度参数问题：分数出现频率（②25%/③40%/④50%）本身没问题，
   加频率只会让同一种题更多，所以修的是模板库数量。

**做法**：给 ②③④ 各补多种分数题骨架（两个分式系数相加、括号内外都有分数、
分数常数与分数系数混合、括号前带减号的三项式等），题面量级不变，不引入大数、不改判题口径。
回归保护：新增断言要求 ②③④ 每档 300 题的"骨架签名"种类 ≥ 5 且每种都出现。

## #3 这个最后一步都没有约分也给算对了

- 状态：open · 2026-11-14 04:31 · 0 评论 · 正文只有一张截图
- 截图内容（equations.html）：题 `1/3 (5x - 1) = 13/6`，学生答 `x = 15/10`，
  页面反馈 **「完全正确！」**（绿色），而下面「完整过程」第 6 步「化系数为一」给的是 `x = 3/2`。

**结论：采纳（这是真 bug）。** 理由：

1. Lead 复现：`evaluateAnswer('x=15/10', 'x=3/2')` 现在返回 `{status:'correct', msg:'完全正确！'}`。
   原因在 `frontend/js/equation-engine.js:464` 的 `evaluateAnswer`：
   学生写的 `x = 常数` 先被 `trySolveValue` 折成一个有理数，再与标准答案 `R.eq` 比较，
   **只比数值、不看是不是最简分数**，所以 `15/10`（值 3/2）直接判对。
2. 页面反馈已经说"完全正确！完整过程在下面"，等于告诉学生"这题不用约分"，
   而解析末步却写 `3/2` —— 自相矛盾，是对学生最有害的一种反馈（教会错的写法）。
3. 和整式化简页的口径不一致：化简页早就有 `unmerged`（对，但没做完）这一档，
   方程页也应该有「对，但结果没化成最简分数」。

**做法**：不改值相等的主逻辑，新增一道"最简"判定。
化到 `x = 常数` 但常数不最简（`15/10`、`4/6`、`-2/4`）→ 返回 `unmerged`，
文案明确告诉学生「对，但结果没化成最简分数」并把分子分母约到最简的写法提示出来；
`x = 3/2`、`x = 1.5`、`x = 4`、`4`、`4 = x` 仍判 `correct`；
`2x = 8` 这类"没化系数为一"的 `unmerged` 保持原样，两种文案要能分清。

## #4 显示有问题

- 状态：open · 2026-11-14 06:05 · 0 评论 · 正文只有一张截图
- 截图内容（practice.html，平板横屏）：软键盘被挤成两列/竖条、按键错位到画面外；
  输入行显示 `x/2+`。

**结论：采纳（分两条）。**

1. **键盘排版崩坏**：`frontend/css/practice.css:214` 的
   `.keyboard { display:grid; grid-template-columns: repeat(5, 1fr); gap:8px; }` 里
   `1fr` 的最小值是 `auto`，`.key` 又有 `padding:15px 0; font-size:1.25rem`，
   一旦主区宽度不够（220px 侧栏常驻 + 平板横屏），5 列网格就会撑破容器；
   页面也没有任何 `max-width` / 视口高度适配。修法是让列宽可以压缩
   （`minmax(0, 1fr)`）、按键高度改成 `min-height`/`aspect-ratio`、字号 `clamp()`，
   并在窄视口给键盘一个 `max-width`。三个练习页共用这份 CSS，三页都要验。
2. **`x/2+`**：需要以真浏览器复现为准 —— 可能是学生自己敲到一半，
   也可能是"加号后没有右操作数时 KaTeX 渲染丢字"。结论见下节。

### #4 修复记录

**① 键盘排版崩坏（已修）** —— `frontend/css/practice.css`：

- `.keyboard`：列宽 `repeat(5, 1fr)` → `repeat(5, minmax(0, 1fr))`，加 `overflow: hidden` 兜底；
- `.key`：`min-width: 0`（去掉隐式 `min-width:auto`），`min-height` / `padding` / `font-size` 改 `clamp()` 跟视口缩；
- `.key.action` / `.key.submit`：字号也改 `clamp()`（这两条比 `.key` 更小，光改 `.key` 管不到），320~360px 下允许折行；
- `.container` / `.topbar` 补 `box-sizing: border-box`：不加的话窄屏下内容栏比主区宽 40px，最后一列会压出主区。

压测对照（把根元素字号提到 20px/24px 并强制 `.key` 不换行，还原旧样式作对照）：
旧样式 390 宽下列宽是 `63.5 63.5 63.5 63.5 80` —— **最后一列被「提交答案」顶到 80px、各列不等宽**，
这就是 issue 里"错位/挤成竖条"的形态；新样式在 390/360/320 三档 + 字号 125%/150% +
820×400（软键盘吃掉半屏）下**列宽恒等、横向溢出 0**。

真浏览器几何复核（Chrome headless + CDP，三个练习页 × 8 视口，1024/1180/1280/1440 桌面、
820 竖屏、390/360 手机、820×400 横屏半屏）：
**横向溢出 0、按键出视口 0、`elementFromPoint` 点不中自己 0、重叠 0**，行结构始终是
practice `5,5,5,5,5`（25 键）/ equations `5,5,5,5,5,1`（26 键）/ math `5,5,5,5,2`（22 键）。

**② 桌面端"键盘变胖"（顺手修的回归）** —— 上面那套 `clamp(44px, 15vw, 55px)` 在 1280 宽的桌面上
会被打成上限，按键从原来的 57px 长到 87px，一屏能看到的题面变少。已补
`@media (min-width: 1024px)`，把 1024px 以上屏的按键钉回原来的 57px（含
`box-sizing: border-box` + `max-height: 60px` + `.keyboard { grid-auto-rows: auto }`，
否则行高会被拉伸吃掉）；手机/窄屏仍是大按键（390 下 85px、360 下 82px，都 ≥44px 可点）。
修后桌面实测：1024 / 1180 / 1280 / 1440 全部 `55~57px`，与改动前一致。

**③ `x/2+`（不是渲染 bug，不需要改代码）** —— 真浏览器里逐键输入实测：
`x` → `x`、`x/` → `x/`、`x/2` → `\dfrac{x}{2}`（分式正常）、`x/2+` → KaTeX 正常排成 `x/2+`、
宽 326px 无裁剪。机制：`frontend/js/math-core.js:285` 的 `toLatexText` 对
`x/2+` 这类"末尾缺右操作数"的表达式 `math.parse` 抛 `Unexpected end of expression`，
catch 后返回 `null`，`frontend/js/practice.js:33` 的 `displayLatex()` 于是回落到字面文本。
**所以截图里那行是"学生刚按完加号、算式还没写完"的正常回显**，不是页面画坏。
若以后想让"输入到一半"也保持分式外观，属于 `math-core.js` 的排版细化，不是缺陷。

**未覆盖**：真平板（真软键盘、系统字号最大）没有实测条件，用浏览器视口模拟代替；
320px 极窄屏下四字的「看解析」会溢出 1~2px 被裁（`overflow-wrap:break-word` 对中文不生效，
要 `word-break: break-all`，但那会让 360 宽下的「提交答案」也强制折行，暂不放）。

---

## 附：三条 issue 的落地情况

| issue | 结论 | 落地 | 防复发 |
|---|---|---|---|
| #2 分数化简模板太单一 | 采纳 | `frontend/js/engine-simplify.js` 的分数题骨架 ②1→6、③3→6、④3→6 种 | `test/fraction.test.js` 加骨架种类断言（每档 500 次抽样，种类 ≥5 且每种都出现） |
| #3 没约分也判对 | 采纳（真 bug） | `frontend/js/equation-engine.js` 增加"最简"判定，未约分返回 `unmerged` 并提示约到最简 | `test/equation.test.js` 新增「对但没约分」用例；`test/ui.smoke.js` 断言页面显示的是引擎给的文案 |
| #4 键盘错位 | 采纳 | `frontend/css/practice.css` 列宽/按键可压缩 + 桌面端高度回钉 | `test/ui.smoke.js` 末尾「键盘版式不溢出」静态断言节（列定义、`min-width:0`、clamp、桌面 `box-sizing/max-height`、三页键数） |

三条都**只改前端**：后端接口与判题口径未动，`npm test` 十一个套件全绿。

---

---

## 追加（2026-11-21）：口算页解析面板在手机上"版式奇怪"

用户反馈的截图：**三星手机浏览器竖屏（约 464 CSS px）、夜间模式、④ 档**，展开「完整过程」后
三处看着不对：

1. 每个步骤右侧多出一竖排 **▲ ─ ▼ 三角钮**（灰白色，压在深色小方块上）；
2. 步骤标题（「2. 先算括号里的」）被挤成两行，公式被推到很右边，标题与公式之间留出一大块空白；
3. 讲解行（「括号里算出来是 19/12」）离它上面的步骤很远，和公式不在一条竖线上。

### 根因

| 现象 | 根因 | 位置 |
|---|---|---|
| ▲ ─ ▼ 三角钮 | `.step-body` 写了 `overflow-x: auto`，而步骤里的公式是 KaTeX 默认 **16px**、页面正文只有 `0.85rem`，每行都横向溢出。桌面 Chrome 画细滚动条，三星/部分安卓内嵌浏览器把横向滚动条画成右缘一排三角钮。手机上**没法用 CSS 隐藏系统滚动条**，只能不产生溢出 | `frontend/css/practice.css:366-370`（`math.html` 与 `equations.html` 共用） |
| 标题折行 + 大空白 | 步骤行是 `flex`：`.step-title{flex:0 0 6.4em}` + `.step-body{flex:1}`，窄屏放不下「标题 + 公式」 | `frontend/css/practice.css:353-370` |
| 讲解行离得远 | `.step-detail` 是 `flex:0 0 100%` 挂在 `align-items:baseline` 的行里，第二行与第一行基线对不齐 | `frontend/css/math-drill.css:74-96` |
| 讲解行右侧顶出面板 | 桌面端 `.steps-panel` 是 flex 容器，`.step-detail` 按内容宽度排，让开标题列的 `padding-left` 之后右边缘溢出（面板 `scrollWidth` 530 vs `clientWidth` 458） | 同上 |

### 改法

- `frontend/css/practice.css` 一个字没动（方程页共用，风险太大），全部改在 `frontend/css/math-drill.css` 的 `.steps-panel` 作用域里：
  - `.steps-panel .step-body { min-width: 0; overflow-x: clip; overflow-wrap: anywhere; }` —— `clip` 不产生滚动容器，从根上消掉滚动条；
  - `.steps-panel .step-body .katex { font-size: 0.92em; }` —— 公式跟着正文走，不再比四周大一圈；
  - `.steps-panel .step-row.has-detail { align-items: flex-start; }`、`.step-detail { max-width: 100%; box-sizing: border-box; }` —— 对齐与不溢出；
  - `@media (max-width: 640px)`：步骤行改成 `display: block`，标题独占一行、公式顶格、讲解紧跟其后。
- 讲解行里的「算式」和「那句人话」拆成两段（`.step-detail-math` / `.step-detail-words`），各用 `inline-block`，长公式整块折行，不会把「平方差公式。」从公式中间劈成两半。
- 引擎侧补齐 `detailTex`：`frontend/js/arith-engine.js` 里「用分配律 / 凑整 / 平方差」四种简算讲解原来 `detailTex: null`，只有纯文本，手机上只能显示成 `25^2 - 1^2 = …`；现在都排成公式。页面 `frontend/js/math-drill-page.js` 的 `detailTailWords()` 把 `detail` 里第一处「，」之后的中文捞回来，跟在公式后面显示。

### 顺带修掉的真 bug：小数题的标准答案显示成假分数

题目是小数（如 `1.4 * 3 + 15`）时，内部答案是 `96/5`，点「看解析」会把学生写的 `19.2` 顶成 `96/5` —— 题面用小数、标准答案却是分数。
现在 `buildQuestion` 多返回一个 `answerDisplay`：题面有小数且这个值写得成有限小数（≤3 位）就显示小数，否则与原 `answer` 相同。
`answer` 不变（判题仍按数值比，写 `19.2`、`96/5` 都算对）。抽样 6000 道 ③ 档：小数题 2246 道，其中 1586 道转成小数显示，其余是 `5.0`/`6.00` 这种整数答案（保持整数）。

### 防复发

- `test/math-drill.test.js` 第 8 节：讲解行里出现 `^` 或分数时**必须**同时给 `detailTex`（变异验证：把平方差那条改回 `''` → 报「讲解行里出现 ^ 或分数时必须同时给 detailTex … 11^2 - 4^2 = …」）；
- `test/math-drill.test.js` 第 7 节（此前已有）+ 本轮补充：`answerDisplay` 与 `answer` 等值、把 `answerDisplay` 填进去判对；
- `test/ui.smoke.js` 末尾 `assertStepsPanelLayout()`：`.steps-panel .step-body` 不能是 `overflow-x: auto/scroll` 且必须 `min-width: 0`、公式字号必须是 `em`、窄屏媒体查询里步骤行必须是 `display: block`、`practice.css` 的 `.step-body` **仍应**保持 `overflow-x: auto`（保证没顺手改坏方程页）。

### 真浏览器复核（headless Chrome + CDP，390×780 / 464×900 / 1280×800）

- 三视口「完整过程」面板 `scrollWidth === clientWidth`（324/324、398/398、458/458），页面无横向溢出；
- 塞入一条「公式 + 人话」讲解行后：`noteScrollW === noteClientW`，人话可见，无右溢；
- 窄屏每行 `display: block`、`overflow-x: clip`、公式 12.5px。

**未覆盖**：真机（三星自带浏览器、系统字号放大）没法在本机复现，本次按「不产生横向溢出」从根上处理，理论上任何浏览器都不会再画滚动条；若仍有异常需要用户提供新的截图。

## 顺带发现（不在 issue 里，但同属"看起来能用、其实不对"）

- `frontend/js/arith-engine.js` 的③进阶会把 `2.3 * 5 + 19` 这种小数乘法的标准答案存成
  `61/2`，弹到页面就是「61/2」，而题面是小数。判题不受影响（写了 `30.5` 也判对），
  但"参考答案显示成假分数"本身就容易让学生以为答案是分数 —— **已在 2026-11-21 修掉，见上一节「顺带修掉的真 bug」**。